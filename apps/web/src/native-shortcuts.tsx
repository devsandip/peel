import { useEffect, useRef, useState } from "react";
import { invoke, listenNative } from "./platform";
const actions = ["capture", "left", "right", "top", "bottom"] as const;
type Action = (typeof actions)[number];
interface Binding {
  control: boolean;
  option: boolean;
  command: boolean;
  shift: boolean;
  key: string;
}
interface Preferences {
  schemaVersion: 1;
  bindings: Record<Action, Binding | null>;
}
interface View {
  preferences: Preferences;
  defaults: Preferences;
  status: Record<Action, { active: boolean; error: string | null }>;
  cleanupRequired: boolean;
  warning: string | null;
}
const names: Record<Action, string> = {
  capture: "Capture",
  left: "Arrange left",
  right: "Arrange right",
  top: "Arrange top",
  bottom: "Arrange bottom",
};
const keyName = (key: string) =>
  key.startsWith("Key")
    ? key.slice(3)
    : key.startsWith("Digit")
      ? key.slice(5)
      : key.startsWith("Arrow")
        ? key.slice(5) + " arrow"
        : key;
const label = (binding: Binding | null) =>
  binding
    ? [
        binding.control ? "Control" : "",
        binding.option ? "Option" : "",
        binding.command ? "Command" : "",
        binding.shift ? "Shift" : "",
        keyName(binding.key),
      ]
        .filter(Boolean)
        .join(" ")
    : "Disabled";
const keys = [
  ...Array.from({ length: 26 }, (_, i) => "Key" + String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => "Digit" + i),
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  ...Array.from({ length: 20 }, (_, i) => "F" + (i + 1)),
];
export function NativeShortcutSettings() {
  const [data, setData] = useState<View | null>(null),
    [editing, setEditing] = useState<Action | null>(null),
    [draft, setDraft] = useState<Binding | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = useRef(0);
  const refresh = async () => {
    const id = ++request.current;
    try {
      const next = await invoke<View>("get_shortcuts");
      if (id === request.current) setData(next);
    } catch (e) {
      if (id === request.current) setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
    let disposed = false;
    let cleanup = () => {};
    void listenNative("peel-shortcuts-changed", () => void refresh()).then(
      (fn) => {
        if (disposed) fn();
        else cleanup = fn;
      },
    );
    return () => {
      disposed = true;
      request.current++;
      cleanup();
    };
  }, []);
  const save = async (preferences: Preferences) => {
    setBusy(true);
    setError("");
    setNotice("");
    const id = ++request.current;
    try {
      const next = await invoke<View>("save_shortcuts", { preferences });
      if (id === request.current) setData(next);
      setEditing(null);
      setNotice("Shortcut settings saved on this device.");
    } catch (e) {
      setError(String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setBusy(true);
    setError("");
    const id = ++request.current;
    try {
      const next = await invoke<View>("retry_shortcuts");
      if (id === request.current) setData(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="shortcut-settings" aria-labelledby="shortcut-title">
      <h3 id="shortcut-title">Global shortcuts</h3>
      <p>
        Choose modifiers and a key. File and Window menu actions remain
        available if a global shortcut cannot register.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>Loading shortcut settings…</p>
      ) : (
        <>
          {data.warning && <p role="alert">{data.warning}</p>}
          {data.cleanupRequired && (
            <p role="alert">
              Some global keys could not be released or confirmed. Retry
              activation, or quit and reopen Peel. Menu actions remain
              available.
            </p>
          )}
          {actions.map((action) => (
            <div className="shortcut-row" key={action}>
              <div>
                <strong>{names[action]}</strong>
                <p>{label(data.preferences.bindings[action])}</p>
                <small>
                  {data.preferences.bindings[action]
                    ? data.status[action].active
                      ? "Registered globally"
                      : "Global shortcut unavailable"
                    : "Use the menu action"}
                </small>
                {data.status[action].error && (
                  <p className="shortcut-error">{data.status[action].error}</p>
                )}
              </div>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(action);
                  setDraft({
                    ...(data.preferences.bindings[action] ??
                      data.defaults.bindings[action]!),
                  });
                  setError("");
                  setNotice("");
                }}
                aria-label={`Change ${names[action]} shortcut`}
              >
                Change
              </button>
            </div>
          ))}
          {editing && draft && (
            <fieldset disabled={busy} className="shortcut-form">
              <legend>{names[editing]} shortcut</legend>
              <div className="shortcut-modifiers">
                {(["control", "option", "command", "shift"] as const).map(
                  (modifier) => (
                    <label key={modifier}>
                      <input
                        type="checkbox"
                        checked={draft[modifier]}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            [modifier]: event.target.checked,
                          })
                        }
                      />
                      {modifier[0].toUpperCase() + modifier.slice(1)}
                    </label>
                  ),
                )}
              </div>
              <label>
                Key{" "}
                <select
                  aria-label="Shortcut key"
                  value={draft.key}
                  onChange={(event) =>
                    setDraft({ ...draft, key: event.target.value })
                  }
                >
                  {keys.map((key) => (
                    <option value={key} key={key}>
                      {keyName(key)}
                    </option>
                  ))}
                </select>
              </label>
              <p>{label(draft)}</p>
              <div className="setting-buttons">
                <button
                  onClick={() =>
                    void save({
                      ...data.preferences,
                      bindings: {
                        ...data.preferences.bindings,
                        [editing]: draft,
                      },
                    })
                  }
                >
                  Save shortcut
                </button>
                <button
                  onClick={() => {
                    setEditing(null);
                    setError("");
                  }}
                >
                  Cancel shortcut change
                </button>
                <button
                  onClick={() =>
                    void save({
                      ...data.preferences,
                      bindings: {
                        ...data.preferences.bindings,
                        [editing]: null,
                      },
                    })
                  }
                >
                  Disable shortcut
                </button>
              </div>
            </fieldset>
          )}
          <div className="setting-buttons">
            <button disabled={busy} onClick={() => void retry()}>
              Retry activation
            </button>
            <button disabled={busy} onClick={() => void save(data.defaults)}>
              Restore shortcut defaults
            </button>
          </div>
        </>
      )}
    </section>
  );
}
