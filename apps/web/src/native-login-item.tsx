import { useEffect, useRef, useState } from "react";
import { invoke } from "./platform";

type Status =
  | "notRegistered"
  | "enabled"
  | "requiresApproval"
  | "notFound"
  | "unavailable"
  | "unsupported"
  | "development"
  | "isolated";
interface View {
  status: Status;
  canChange: boolean;
  error: string | null;
}
const descriptions: Record<Status, string> = {
  notRegistered: "Off. Open Synkies when you need it.",
  enabled: "On. macOS reports Synkies is eligible to open at login.",
  requiresApproval:
    "Waiting for approval in System Settings, General, Login Items. Synkies is not currently eligible to open at login.",
  notFound:
    "macOS could not find the login item. Use the installed, signed Synkies app and check again.",
  unavailable: "macOS could not report the login item status. Check again.",
  unsupported: "Launch at login is available only in the Mac app.",
  development:
    "Launch at login is unavailable in this development executable. Use the installed, signed Synkies app.",
  isolated:
    "Launch at login is disabled for this isolated test library. Your Mac login items stay unchanged.",
};
export function NativeLoginItemSettings() {
  const [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0);
  const changing = useRef(false);
  const refresh = async () => {
    const id = ++request.current;
    try {
      const next = await invoke<View>("get_login_item");
      if (id === request.current) setView(next);
    } catch (e) {
      if (id === request.current) setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const focus = () => {
      if (!changing.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      request.current++;
      window.removeEventListener("focus", focus);
    };
  }, []);
  const change = async (enabled: boolean) => {
    changing.current = true;
    setBusy(true);
    setError("");
    const id = ++request.current;
    try {
      const next = await invoke<View>("set_login_item", { enabled });
      if (id === request.current) setView(next);
    } catch (e) {
      setError(String(e));
      await refresh();
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="login-item-title" className="login-settings">
      <h3 id="login-item-title">Launch at login</h3>
      <p>
        Start Synkies automatically when you sign in to this Mac. Turning this
        off leaves Synkies running until you quit. This choice stays on this
        Mac.
      </p>
      {(error || view?.error) && <p role="alert">{error || view?.error}</p>}
      <p role="status">
        {view ? descriptions[view.status] : "Checking macOS login settings…"}
      </p>
      <div className="setting-buttons">
        {view?.canChange && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void change(
                  !["enabled", "requiresApproval"].includes(view.status),
                )
              }
            >
              {["enabled", "requiresApproval"].includes(view.status)
                ? "Turn off launch at login"
                : "Turn on launch at login"}
            </button>
            {view.status === "requiresApproval" && (
              <button
                disabled={busy}
                onClick={() => {
                  setError("");
                  void invoke("open_login_item_settings").catch((e) =>
                    setError(String(e)),
                  );
                }}
              >
                Open Login Items settings
              </button>
            )}
          </>
        )}
        <button
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh();
          }}
        >
          Check login status again
        </button>
      </div>
    </section>
  );
}
