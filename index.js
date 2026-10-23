/**
 * dsh-taskbar-glow —— 任务栏图标发光提示（Host 半区）。
 *
 * 解决的问题：DSH 在后台跑的时候，人切去干别的；一轮结束、或者弹出审批 /
 * 提问需要人点一下的时候，没有任何提示。这个插件在这些时刻让 Windows
 * 任务栏上的 DSH 图标闪烁（FlashWindowEx），把注意力叫回来。
 *
 * 触发点：
 *   - agent/status：某个 agent 从 running 回到 idle（一轮跑完）——只认根 agent，
 *     subagent 收工不算，避免提前打扰；
 *   - approval/request：弹出工具审批，等你点「允许 / 拒绝」；
 *   - user-questions/request：AI 用 ask_user_question 提问，等你回答。
 *
 * 只在 DSH 窗口不在前台时触发；窗口在前台说明你正看着屏幕，不用打扰。
 * 闪烁用 FLASHW_TIMERNOFG：系统会一直闪到窗口被激活（或用配置里的
 * stopAfterSeconds 主动收住）。
 *
 * 原生调用走 koffi（桌面版运行时自带，用于 LibreOfficeKit），不需要任何
 * 编译步骤；找不到 koffi 时插件只是安静地降级为「不可用」，不会影响 DSH。
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const PACKAGE = 'dsh-taskbar-glow';
const VERSION = '0.1.0';
/** 诊断日志与状态的存放目录（<DSH_HOME>/taskbar-glow）。 */
const STATE_DIR = 'taskbar-glow';
const LOG_LIMIT_BYTES = 256 * 1024;

/** FLASHW_* 常量（winuser.h）。 */
const FLASHW_ALL = 0x1 | 0x2; // 标题栏 + 任务栏按钮
const FLASHW_TIMERNOFG = 0xc; // 一直闪，直到窗口回到前台
const FLASHW_STOP = 0x0;

/** 两个提醒之间的最小间隔，避免「回合结束」和「审批」挨在一起时闪两次。 */
const MIN_FLASH_INTERVAL_MS = 1500;

const DEFAULT_CONFIG = {
  enabled: true,
  onTurnEnd: true,
  onApproval: true,
  onQuestion: true,
  skipWhenFocused: true,
  testDelaySeconds: 5,
  stopAfterSeconds: 0,
  log: true,
};

/**
 * 把 patch 里的原始 config 收敛成完整、可用的配置。
 * 没有 Config schema，所以这里自己校验：类型不对就用默认值，绝不抛错。
 */
function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const seconds = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled),
    onTurnEnd: bool(input.onTurnEnd, DEFAULT_CONFIG.onTurnEnd),
    onApproval: bool(input.onApproval, DEFAULT_CONFIG.onApproval),
    onQuestion: bool(input.onQuestion, DEFAULT_CONFIG.onQuestion),
    skipWhenFocused: bool(input.skipWhenFocused, DEFAULT_CONFIG.skipWhenFocused),
    testDelaySeconds: seconds(input.testDelaySeconds, DEFAULT_CONFIG.testDelaySeconds),
    stopAfterSeconds: seconds(input.stopAfterSeconds, DEFAULT_CONFIG.stopAfterSeconds),
    log: bool(input.log, DEFAULT_CONFIG.log),
  };
}

function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), '.dsh');
}

/** 读界面里保存过的配置；没有或损坏都当成空对象。 */
function readSavedConfig() {
  try {
    const parsed = JSON.parse(readFileSync(join(resolveDshHome(), STATE_DIR, 'config.json'), 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 找到桌面版运行时自带的 koffi。
 *
 * 桌面版把 dsh 运行时放在 resources/app.asar 里，原生二进制解包在
 * resources/app.asar.unpacked；不需要 asar 支持也能直接按路径 require。
 * 依次尝试：运行时目录 → app.asar.unpacked → 从入口脚本解析 → 安装目录。
 */
function loadKoffi() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  const runtimeDir = process.argv[2];

  if (typeof runtimeDir === 'string' && runtimeDir.length > 0) {
    const unpacked = runtimeDir.includes('app.asar.unpacked')
      ? runtimeDir
      : runtimeDir.replace(/([\\/])app\.asar(?!\.unpacked)/u, '$1app.asar.unpacked');
    candidates.push(join(unpacked, 'node_modules', 'koffi'));
    candidates.push(join(runtimeDir, 'node_modules', 'koffi'));
  }
  for (const anchor of [process.argv[1], import.meta.url]) {
    if (typeof anchor !== 'string' || anchor.length === 0) continue;
    try {
      candidates.push(createRequire(anchor).resolve('koffi'));
    } catch {
      // 这个锚点解析不到，换下一个
    }
  }
  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', 'koffi'));
  candidates.push(join(execDir, 'resources', 'app.asar', 'dsh', 'node_modules', 'koffi'));

  const tried = [];
  let lastError;
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0 || tried.includes(candidate)) continue;
    tried.push(candidate);
    try {
      return { koffi: require(candidate), koffiPath: candidate };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    error: lastError instanceof Error ? lastError.message : String(lastError ?? 'koffi not found'),
    tried,
  };
}

/**
 * 用 koffi 声明 user32 里需要的那几个函数，返回一个很小的「闪烁器」。
 * 声明过的 koffi 类型不能重复声明，所以整只闪烁器缓存在 globalThis 上，
 * 配置热重载 / HMR 重新 apply 时复用同一份。
 */
function createFlasher() {
  if (process.platform !== 'win32') {
    return { available: false, error: `unsupported platform: ${process.platform}` };
  }
  // 只有桌面版 Host 才值得闪：它是 Electron 主进程 fork 出来的（有 IPC，
  // process.send 存在），父进程正好是窗口属主。CLI / 浏览器模式下闪终端窗口是错的。
  if (typeof process.send !== 'function') {
    return { available: false, error: 'not a desktop host (no IPC channel to the Electron shell)' };
  }
  const loaded = loadKoffi();
  if (loaded.koffi === undefined) {
    return { available: false, error: loaded.error, tried: loaded.tried };
  }

  try {
    const koffi = loaded.koffi;
    const user32 = koffi.load('user32.dll');

    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
    const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
    const GetWindowThreadProcessId = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)',
    );
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
    const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)');
    const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
    const FlashWindowInfo = koffi.struct('FLASHWINFO', {
      cbSize: 'uint32_t',
      hwnd: 'void *',
      dwFlags: 'uint32_t',
      uCount: 'uint32_t',
      dwTimeout: 'uint32_t',
    });
    const FlashWindowEx = user32.func('bool __stdcall FlashWindowEx(FLASHWINFO *pfwi)');
    const flashInfoSize = koffi.sizeof(FlashWindowInfo);

    /** 读一个窗口的属主进程 id。 */
    const pidOf = (hwnd) => {
      const buffer = [0];
      GetWindowThreadProcessId(hwnd, buffer);
      return buffer[0];
    };

    /** 读窗口标题（空标题的顶层窗口都是 IME / GDI 之类的辅助窗口，跳过）。 */
    const titleOf = (hwnd) => {
      const buffer = new Uint16Array(512);
      const length = GetWindowTextW(hwnd, buffer, buffer.length);
      if (length <= 0) return '';
      return Buffer.from(buffer.buffer, 0, Math.min(length, buffer.length) * 2).toString('utf16le');
    };

    /**
     * 找 DSH 的主窗口：优先认「本进程的父进程」——Host 是 Electron 主进程
     * fork 出来的，所以父进程正好就是窗口的属主；进程树对不上时退回按标题找。
     */
    function findWindow() {
      const parent = typeof process.ppid === 'number' ? process.ppid : 0;
      const byParent = [];
      const byTitle = [];
      EnumWindows((hwnd) => {
        if (!IsWindowVisible(hwnd)) return true;
        const title = titleOf(hwnd);
        if (title.length === 0) return true;
        const pid = pidOf(hwnd);
        if (parent !== 0 && pid === parent) byParent.push({ hwnd, pid, title });
        else if (title.includes('DeepSeek Harness')) byTitle.push({ hwnd, pid, title });
        return true;
      }, 0);
      const list = byParent.length > 0 ? byParent : byTitle;
      return list.length > 0 ? list[0] : undefined;
    }

    /** 前台窗口是不是 DSH 自己的主进程——是的话说明用户正看着。 */
    function isFocused() {
      const foreground = GetForegroundWindow();
      if (foreground === null || foreground === undefined) return false;
      const pid = pidOf(foreground);
      return typeof process.ppid === 'number' && pid === process.ppid;
    }

    function flash(hwnd) {
      return FlashWindowEx({
        cbSize: flashInfoSize,
        hwnd,
        dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
        uCount: 0,
        dwTimeout: 0,
      });
    }

    function stop(hwnd) {
      return FlashWindowEx({ cbSize: flashInfoSize, hwnd, dwFlags: FLASHW_STOP, uCount: 0, dwTimeout: 0 });
    }

    return { available: true, error: null, koffiPath: loaded.koffiPath, findWindow, isFocused, flash, stop };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const FLASHER_CACHE_KEY = Symbol.for('dsh-taskbar-glow:flasher');

/** 整进程只建一次；HMR 换了模块实例也复用。 */
function getFlasher() {
  if (globalThis[FLASHER_CACHE_KEY] === undefined) {
    globalThis[FLASHER_CACHE_KEY] = createFlasher();
  }
  return globalThis[FLASHER_CACHE_KEY];
}

/** 把 JSON 写回去，尽量不把错误抛给 HTTP 层。 */
function sendJson(res, body, statusCode = 200) {
  try {
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(`${JSON.stringify(body, null, 2)}\n`);
  } catch {
    // 客户端提前断开之类，忽略
  }
}

export function apply(ctx, config) {
  const flasher = getFlasher();
  const logDir = join(resolveDshHome(), STATE_DIR);
  const logFile = join(logDir, 'taskbar-glow.log');
  const configFile = join(logDir, 'config.json');
  const logger = typeof ctx.logger === 'function' ? ctx.logger(PACKAGE) : undefined;

  // 配置优先级：界面里保存的 config.json > bundle patch 里的默认值 > 内置默认。
  const patchConfig = config !== null && typeof config === 'object' ? config : {};
  let cfg = normalizeConfig({ ...patchConfig, ...readSavedConfig() });

  const state = {
    running: new Set(),
    timers: new Set(),
    lastFlashAt: 0,
    lastFlashISO: null,
    lastReason: null,
    lastReturned: null,
  };

  /** 诊断日志：写文件（带 256KB 上限），同时丢一份给 DSH 的日志。 */
  function log(level, message) {
    if (cfg.log) {
      try {
        mkdirSync(logDir, { recursive: true });
        try {
          if (statSync(logFile).size > LOG_LIMIT_BYTES) writeFileSync(logFile, '');
        } catch {
          // 文件还不存在
        }
        appendFileSync(logFile, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`);
      } catch {
        // 日志写不进去不该影响提示本身
      }
    }
    if (logger !== undefined) {
      const target = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.info;
      try {
        if (typeof target === 'function') target.call(logger, message);
      } catch {
        // 忽略
      }
    }
  }

  /** 插件自己持有的定时器：销毁时统一清掉。 */
  function later(callback, delayMs) {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      try {
        callback();
      } catch (error) {
        log('error', `timer failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    state.timers.add(timer);
    return timer;
  }

  ctx.effect(() => () => {
    for (const timer of state.timers) clearTimeout(timer);
    state.timers.clear();
  });

  /**
   * 真正闪的那一下：先看开关，再看窗口在不在前台。
   * 外层兜底：任何意外都只记日志，绝不把异常抛回 approval / question 的
   * waterfall —— 提示功能坏了也不能连累 DSH 自己的审批流程。
   */
  function flashNow(reason) {
    try {
      return flashNowInner(reason);
    } catch (error) {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      log('error', `flash (${reason}) failed: ${detail}`);
      return { flashed: false, reason: 'error', error: String(error) };
    }
  }

  function flashNowInner(reason) {
    if (!cfg.enabled) {
      log('info', `skip (${reason}): plugin disabled`);
      return { flashed: false, reason: 'disabled' };
    }
    if (!flasher.available) {
      log('warn', `skip (${reason}): native flash unavailable: ${flasher.error ?? 'unknown'}`);
      return { flashed: false, reason: 'native-unavailable', error: flasher.error ?? 'unknown' };
    }

    const now = Date.now();
    if (now - state.lastFlashAt < MIN_FLASH_INTERVAL_MS) {
      log('info', `skip (${reason}): throttled (${now - state.lastFlashAt}ms since last flash)`);
      return { flashed: false, reason: 'throttled' };
    }

    const window = flasher.findWindow();
    if (window === undefined) {
      log('warn', `skip (${reason}): no DSH window found (ppid=${process.ppid})`);
      return { flashed: false, reason: 'no-window' };
    }
    if (cfg.skipWhenFocused && flasher.isFocused()) {
      log('info', `skip (${reason}): DSH is in the foreground`);
      return { flashed: false, reason: 'focused' };
    }

    const returned = flasher.flash(window.hwnd);
    state.lastFlashAt = now;
    state.lastFlashISO = new Date(now).toISOString();
    state.lastReason = reason;
    state.lastReturned = Boolean(returned);
    log(
      'info',
      `flash reason=${reason} hwnd=${String(window.hwnd)} pid=${window.pid} title=${JSON.stringify(window.title)} returned=${returned}`,
    );

    if (cfg.stopAfterSeconds > 0) {
      later(() => flasher.stop(window.hwnd), cfg.stopAfterSeconds * 1000);
    }
    return {
      flashed: true,
      reason,
      window: { hwnd: String(window.hwnd), pid: window.pid, title: window.title },
      returned: Boolean(returned),
    };
  }

  /** 只对根 agent 提醒：subagent 收工不算一轮结束。 */
  function isRootAgent(agent) {
    const agents = ctx.get('agents');
    if (agents === undefined || typeof agents.roots !== 'function') return true;
    try {
      return agents.roots().some((root) => root.id === agent.id);
    } catch {
      return true;
    }
  }

  // 插件可能是「一轮对话进行中」装上的：把此刻正在跑的根 agent 记下来，
  // 这样这一轮结束时也能正常提醒。
  try {
    const agents = ctx.get('agents');
    for (const agent of agents?.list?.() ?? []) {
      if (agent.status === 'running' && isRootAgent(agent)) state.running.add(agent.id);
    }
  } catch {
    // 拿不到就当没有
  }

  // ① 一轮跑完：running → idle，且是根 agent。
  ctx.on('agent/status', (payload) => {
    const agent = payload?.agent;
    const status = payload?.status;
    if (agent === undefined || agent === null) return;
    if (status === 'running') {
      state.running.add(agent.id);
      return;
    }
    if (status !== 'idle') return;
    const wasRunning = state.running.delete(agent.id);
    if (!wasRunning || !cfg.onTurnEnd) return;
    if (!isRootAgent(agent)) return;
    flashNow('turn-end');
  });

  // ② 工具审批：等用户点「允许 / 拒绝」。
  ctx.on('approval/request', (request, next) => {
    if (cfg.onApproval) {
      const tool = typeof request?.toolName === 'string' ? request.toolName : 'tool';
      flashNow(`approval:${tool}`);
    }
    return next();
  });

  // ③ AI 提问：等用户回答。
  ctx.on('user-questions/request', (request, next) => {
    if (cfg.onQuestion) {
      const first = Array.isArray(request?.questions) ? request.questions[0] : undefined;
      const head = typeof first?.question === 'string' ? first.question.slice(0, 40) : 'question';
      flashNow(`question:${head}`);
    }
    return next();
  });

  /** 现场体检：窗口、前台状态、原生库、配置、最近一次闪烁。 */
  function status() {
    let window;
    let focused;
    if (flasher.available) {
      try {
        window = flasher.findWindow();
      } catch {
        window = undefined;
      }
      try {
        focused = flasher.isFocused();
      } catch {
        focused = undefined;
      }
    }
    return {
      package: PACKAGE,
      version: VERSION,
      platform: process.platform,
      desktopHost: typeof process.send === 'function',
      hostPid: process.pid,
      parentPid: process.ppid,
      clientModule: (() => {
        try {
          const modules = ctx.get('clientModules');
          return modules === undefined ? null : Boolean(modules.clientPath?.(PACKAGE));
        } catch {
          return null;
        }
      })(),
      native: {
        available: Boolean(flasher.available),
        error: flasher.error ?? null,
        koffiPath: flasher.koffiPath ?? null,
      },
      config: cfg,
      window:
        window === undefined
          ? null
          : { hwnd: String(window.hwnd), pid: window.pid, title: window.title },
      foregroundIsDsh: focused ?? null,
      lastFlash: state.lastFlashISO,
      lastReason: state.lastReason,
      lastReturned: state.lastReturned,
      logFile,
      configFile,
    };
  }

  /** 界面改配置：直接生效，并写进 config.json，重启后仍然有效。 */
  function saveConfig(patch) {
    const next = normalizeConfig({ ...cfg, ...(patch !== null && typeof patch === 'object' ? patch : {}) });
    cfg = next;
    try {
      mkdirSync(logDir, { recursive: true });
      writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    } catch (error) {
      log('warn', `could not persist config: ${error instanceof Error ? error.message : String(error)}`);
    }
    log('info', `config updated: ${JSON.stringify(next)}`);
    return next;
  }

  /** 读一小段 JSON 请求体（配置就几十字节，超过 16KB 直接拒绝）。 */
  function readJsonBody(request, limit = 16 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('body too large'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (error) {
          reject(error);
        }
      });
      request.on('error', reject);
    });
  }

  // 测试命令：在输入框里敲 /flash，延迟几秒再闪——正好留出切窗口的时间。
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() =>
      commandCtx.commands.register({
        name: 'flash',
        description: '测试任务栏发光提醒：延迟几秒后闪烁 DSH 的任务栏图标（先切到别的窗口才看得到）。',
        handler: () => {
          if (!flasher.available) {
            return { kind: 'error', text: `任务栏提示不可用：${flasher.error ?? 'unknown'}` };
          }
          const delay = cfg.testDelaySeconds;
          later(() => flashNow('command-test'), delay * 1000);
          return {
            kind: 'success',
            text: `好，${delay} 秒后闪烁任务栏图标——现在切到别的窗口就能看到。`,
          };
        },
      }),
    );
  });

  // 测试 / 诊断用的本地 HTTP 入口（只在 127.0.0.1 上）：
  //   GET  /taskbar-glow/status  → 体检 JSON
  //   GET  /taskbar-glow/flash   → 延迟几秒后闪一下
  //   GET  /taskbar-glow/config  → 当前配置（设置页读）
  //   POST /taskbar-glow/config  → 改配置，立即生效并持久化（设置页写）
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'exact',
        path: '/taskbar-glow/status',
        handler: (_request, response) => {
          sendJson(response, status());
        },
      }),
    );
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'exact',
        path: '/taskbar-glow/flash',
        handler: (_request, response) => {
          const delay = cfg.testDelaySeconds;
          later(() => flashNow('http-test'), delay * 1000);
          sendJson(response, {
            scheduled: true,
            delaySeconds: delay,
            hint: '现在切到别的窗口，稍后就能看到任务栏闪烁。',
            status: status(),
          });
        },
      }),
    );
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'exact',
        path: '/taskbar-glow/config',
        handler: (request, response) => {
          if (request.method === 'POST') {
            void readJsonBody(request)
              .then((patch) => {
                const next = saveConfig(patch);
                sendJson(response, { ok: true, config: next });
              })
              .catch((error) => {
                sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
              });
            return;
          }
          sendJson(response, {
            ok: true,
            config: cfg,
            defaults: DEFAULT_CONFIG,
            native: { available: Boolean(flasher.available), error: flasher.error ?? null },
            logFile,
            configFile,
          });
        },
      }),
    );
  });

  log(
    'info',
    `plugin loaded v${VERSION} platform=${process.platform} native=${flasher.available ? 'ready' : `unavailable (${flasher.error ?? 'unknown'})`} desktopHost=${typeof process.send === 'function'}`,
  );
}
