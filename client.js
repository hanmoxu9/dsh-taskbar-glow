/**
 * dsh-taskbar-glow —— 浏览器半区。
 *
 * 只做一件事：在「插件 → dsh-taskbar-glow → 任务栏发光提示」这一行挂一个
 * 配置页（plugins.row.config 槽，key = "<包名>#<行 id>"）。页面读写走同源的
 * /taskbar-glow/config 接口，Host 半区负责持久化并立即生效。
 *
 * 这份文件由宿主作为经典脚本直接提供给浏览器，所以不能有 import/export，
 * 只能用外壳提供的 require 取 React。
 */
window.__ModuleLoader__.load({
  id: 'dsh-taskbar-glow',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useState } = React;

    const API_CONFIG = '/taskbar-glow/config';
    const API_FLASH = '/taskbar-glow/flash';
    /** `plugins.row.config` 的 key：包名#行 id。 */
    const SLOT_KEY = 'dsh-taskbar-glow#taskbar-glow';

    /* ── 文案（跟随 DSH 语言，取不到就中文） ─────────────────────────── */
    const STRINGS = {
      zh: {
        summary: 'DSH 在后台跑完一轮、或等你审批 / 回答时，闪烁 Windows 任务栏图标。窗口在前台时不打扰。',
        intro: 'DSH 在后台跑完一轮、或弹出审批 / 提问等你处理时，让 Windows 任务栏上的 DSH 图标闪烁，把注意力叫回来。',
        when: '什么时候提醒',
        enabled: '启用任务栏提醒',
        enabledHint: '关掉后完全不闪，其它设置保留。',
        turnEnd: '一轮对话跑完',
        turnEndHint: '根 agent 从运行回到空闲；subagent 收工不算。',
        approval: '弹出工具审批',
        approvalHint: '等你点「允许 / 拒绝」的时候。',
        question: 'AI 提问等你回答',
        questionHint: 'AI 用 ask_user_question 提问的时候。',
        how: '提醒方式',
        quiet: '窗口在前台时不打扰',
        quietHint: '你正看着屏幕就不闪；切到别的窗口才会提醒。',
        stopAfter: '闪烁持续秒数',
        stopAfterHint: '0 = 一直闪，直到把 DSH 切回前台。',
        test: '测试',
        delay: '测试延迟秒数',
        delayHint: '留出切到别的窗口的时间。',
        testButton: '测试闪烁',
        testScheduled: '已安排：{n} 秒后闪烁任务栏图标，现在切到别的窗口就能看到。',
        testFailed: '测试失败：Host 没有响应。',
        log: '写诊断日志',
        logHint: '日志在 <DSH_HOME>/taskbar-glow/taskbar-glow.log，出问题时先看这里。',
        loading: '正在读取配置…',
        loadFailed: '读不到配置，插件可能没在运行。',
        saveFailed: '保存失败：Host 没有响应。',
        saved: '已保存，立即生效。',
        nativeReady: '原生调用：就绪',
        nativeOff: '原生调用：不可用（{error}）',
        configFile: '配置文件：{path}',
      },
      en: {
        summary: 'Flashes the Windows taskbar icon when a turn finishes in the background or an approval / question is waiting. Quiet while DSH is focused.',
        intro: 'When DSH finishes a turn in the background, or an approval / question is waiting for you, it flashes the DSH taskbar icon to get your attention.',
        when: 'When to flash',
        enabled: 'Enable taskbar attention',
        enabledHint: 'Turns the feature off entirely; the other settings are kept.',
        turnEnd: 'A turn finished',
        turnEndHint: 'A root agent went from running back to idle; subagent completions do not count.',
        approval: 'A tool approval is waiting',
        approvalHint: 'While DSH waits for you to allow or reject a tool call.',
        question: 'A question is waiting',
        questionHint: 'While an ask_user_question call waits for your answer.',
        how: 'How to flash',
        quiet: 'Stay quiet while DSH is focused',
        quietHint: 'No flash when you are already looking at DSH; only when it is in the background.',
        stopAfter: 'Stop after (seconds)',
        stopAfterHint: '0 = keep flashing until DSH is brought back to the foreground.',
        test: 'Test',
        delay: 'Test delay (seconds)',
        delayHint: 'Leaves you time to switch to another window.',
        testButton: 'Flash now',
        testScheduled: 'Scheduled: the taskbar icon flashes in {n} seconds — switch to another window now.',
        testFailed: 'Test failed: the host did not respond.',
        log: 'Write a diagnostic log',
        logHint: 'Log file: <DSH_HOME>/taskbar-glow/taskbar-glow.log — check it first when nothing flashes.',
        loading: 'Reading configuration…',
        loadFailed: 'Could not read the configuration; the plugin may not be running.',
        saveFailed: 'Could not save: the host did not respond.',
        saved: 'Saved — applied immediately.',
        nativeReady: 'Native call: ready',
        nativeOff: 'Native call: unavailable ({error})',
        configFile: 'Config file: {path}',
      },
    };

    const S = {
      summary: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px' },
      wrap: { display: 'flex', flexDirection: 'column', gap: 16, padding: '2px 0 10px' },
      intro: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px' },
      section: { display: 'flex', flexDirection: 'column' },
      sectionTitle: {
        margin: '0 0 2px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: 'var(--dsw-alias-label-secondary)',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      label: { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      check: { width: 16, height: 16, flex: '0 0 auto', cursor: 'pointer', accentColor: 'var(--dsw-alias-brand-primary)' },
      input: {
        width: 76,
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
      },
      button: {
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        cursor: 'pointer',
      },
      footer: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      error: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
      ok: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary)' },
    };

    /** 当前语言：zh 开头就中文，其余英文；取不到语言服务时按中文。 */
    function useLang(ctx) {
      const read = useCallback(() => {
        try {
          const active = ctx.get('locale')?.getLocale?.().active;
          return typeof active === 'string' ? active : '';
        } catch {
          return '';
        }
      }, [ctx]);
      const [active, setActive] = useState(read);
      useEffect(() => {
        let off;
        try {
          off = ctx.get('locale')?.subscribe?.(() => setActive(read()));
        } catch {
          off = undefined;
        }
        return () => {
          if (typeof off === 'function') off();
        };
      }, [ctx, read]);
      return active.toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    function Row(props) {
      return h(
        'div',
        { style: S.row },
        h(
          'span',
          { style: S.rowText },
          h('span', { style: S.label }, props.label),
          props.hint ? h('span', { style: S.hint }, props.hint) : null,
        ),
        props.children,
      );
    }

    function ToggleRow(props) {
      return h(
        Row,
        { label: props.label, hint: props.hint },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          style: S.check,
          checked: Boolean(props.checked),
          onChange: (event) => props.onChange(event.target.checked),
        }),
      );
    }

    function NumberRow(props) {
      return h(
        Row,
        { label: props.label, hint: props.hint },
        h('input', {
          type: 'number',
          min: 0,
          max: props.max ?? 600,
          step: 1,
          'aria-label': props.label,
          style: S.input,
          value: props.value,
          onChange: (event) => props.onChange(Number(event.target.value)),
        }),
      );
    }

    function SettingsPage(props) {
      const ctx = props?.ctx;
      const lang = useLang(ctx);
      const s = STRINGS[lang] ?? STRINGS.zh;
      const isSummary = props?.view === 'summary';
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [saved, setSaved] = useState(false);
      const [hint, setHint] = useState('');

      useEffect(() => {
        if (isSummary) return undefined;
        let alive = true;
        fetch(API_CONFIG, { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((payload) => {
            if (!alive) return;
            if (payload?.ok === true && payload.config) setData(payload);
            else setError(s.loadFailed);
          })
          .catch(() => {
            if (alive) setError(s.loadFailed);
          });
        return () => {
          alive = false;
        };
      }, [isSummary]);

      if (isSummary) return h('p', { style: S.summary }, s.summary);

      if (data === null) {
        return error !== '' ? h('p', { style: S.error }, error) : h('p', { style: S.hint }, s.loading);
      }

      const config = data.config;
      const update = (patch) => {
        setError('');
        setSaved(false);
        setHint('');
        setData((current) => ({ ...current, config: { ...current.config, ...patch } }));
        fetch(API_CONFIG, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((response) => response.json())
          .then((payload) => {
            if (payload?.ok === true && payload.config) {
              setData((current) => ({ ...current, config: payload.config }));
              setSaved(true);
            } else {
              setError(s.saveFailed);
            }
          })
          .catch(() => setError(s.saveFailed));
      };

      const runTest = () => {
        setHint('');
        fetch(API_FLASH)
          .then((response) => response.json())
          .then((payload) => {
            const seconds = payload?.delaySeconds ?? config.testDelaySeconds ?? 5;
            setHint(s.testScheduled.replace('{n}', String(seconds)));
          })
          .catch(() => setHint(s.testFailed));
      };

      return h(
        'div',
        { style: S.wrap, 'data-plugin': 'dsh-taskbar-glow' },
        h('p', { style: S.intro }, s.intro),

        h(
          'div',
          { style: S.section },
          h('h4', { style: S.sectionTitle }, s.when),
          h(ToggleRow, {
            label: s.enabled,
            hint: s.enabledHint,
            checked: config.enabled !== false,
            onChange: (value) => update({ enabled: value }),
          }),
          h(ToggleRow, {
            label: s.turnEnd,
            hint: s.turnEndHint,
            checked: config.onTurnEnd !== false,
            onChange: (value) => update({ onTurnEnd: value }),
          }),
          h(ToggleRow, {
            label: s.approval,
            hint: s.approvalHint,
            checked: config.onApproval !== false,
            onChange: (value) => update({ onApproval: value }),
          }),
          h(ToggleRow, {
            label: s.question,
            hint: s.questionHint,
            checked: config.onQuestion !== false,
            onChange: (value) => update({ onQuestion: value }),
          }),
        ),

        h(
          'div',
          { style: S.section },
          h('h4', { style: S.sectionTitle }, s.how),
          h(ToggleRow, {
            label: s.quiet,
            hint: s.quietHint,
            checked: config.skipWhenFocused !== false,
            onChange: (value) => update({ skipWhenFocused: value }),
          }),
          h(NumberRow, {
            label: s.stopAfter,
            hint: s.stopAfterHint,
            value: config.stopAfterSeconds ?? 0,
            onChange: (value) => update({ stopAfterSeconds: Number.isFinite(value) ? Math.max(0, value) : 0 }),
          }),
        ),

        h(
          'div',
          { style: S.section },
          h('h4', { style: S.sectionTitle }, s.test),
          h(NumberRow, {
            label: s.delay,
            hint: s.delayHint,
            value: config.testDelaySeconds ?? 5,
            onChange: (value) => update({ testDelaySeconds: Number.isFinite(value) ? Math.max(0, value) : 5 }),
          }),
          h(
            Row,
            { label: s.testButton, hint: hint },
            h('button', { type: 'button', style: S.button, onClick: runTest }, s.testButton),
          ),
        ),

        h(ToggleRow, {
          label: s.log,
          hint: s.logHint,
          checked: config.log !== false,
          onChange: (value) => update({ log: value }),
        }),

        h(
          'div',
          null,
          h(
            'p',
            { style: data.native?.available ? S.footer : S.error },
            data.native?.available
              ? s.nativeReady
              : s.nativeOff.replace('{error}', data.native?.error ?? '?'),
          ),
          h('p', { style: S.footer }, s.configFile.replace('{path}', data.configFile ?? '')),
          saved ? h('p', { style: S.ok }, s.saved) : null,
          error !== '' ? h('p', { style: S.error }, error) : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: SLOT_KEY,
            },
            (props) => h(SettingsPage, { ...props, ctx }),
          ),
        );
      },
    };
  },
});
