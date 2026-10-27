// A browser-only IPC fixture. It does not simulate real OS windows or a file picker.
export function installNativeFixture(options: {
  cold: boolean;
  failRetry: boolean;
}) {
  const callbacks = new Map<number, (value: unknown) => unknown>(),
    listeners = new Map<number, { event: string; handler: number }>();
  let sequence = 0;
  const shortcutActions = [
    "capture",
    "left",
    "right",
    "top",
    "bottom",
  ] as const;
  const shortcutDefaults = {
    schemaVersion: 1,
    bindings: Object.fromEntries(
      shortcutActions.map((action, i) => [
        action,
        {
          control: true,
          option: true,
          command: action !== "capture",
          shift: false,
          key: ["KeyN", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"][i],
        },
      ]),
    ),
  };
  let shortcutPreferences = structuredClone(shortcutDefaults);
  let note = {
    schemaVersion: 1,
    collectionId: "local",
    noteId: "synthetic-native-note",
    bodyMarkdown:
      "# Native bridge fixture\nSynthetic acknowledged text. ##fixture",
    state: "archived",
    createdAt: "2026-10-26T16:00:00.000Z",
    updatedAt: "2026-10-26T16:00:00.000Z",
    deletedAt: null,
    purgeAfter: null,
    serverRevision: null,
    localRevision: 1,
  };
  const fixture = {
    available: !options.cold,
    failRetry: options.failRetry,
    holdSave: false,
    failSaves: false,
    failShortcutSave: false,
    loginStatus: "notRegistered",
    failLoginChange: false,
    holdLoginChange: false,
    releaseLoginChange: () => {},
    loginChanges: [] as boolean[],
    calls: [] as string[],
    acknowledgements: [] as { operationId: string; success: boolean }[],
    errors: [] as string[],
    releaseSave: () => {},
    emit(event: string, payload: unknown) {
      for (const [id, entry] of listeners)
        if (entry.event === event) {
          try {
            void Promise.resolve(
              callbacks.get(entry.handler)?.({ event, id, payload }),
            ).catch((e) => fixture.errors.push(String(e)));
          } catch (e) {
            fixture.errors.push(String(e));
          }
        }
    },
  };
  const info = () => ({
    available: fixture.available,
    folder: fixture.available ? "/synthetic/Peel library" : null,
    previousFolder: null,
    requiresRestart: false,
    error: fixture.available
      ? null
      : "Synthetic selected drive is unavailable. No fallback library was opened.",
  });
  const shortcutView = () => ({
    preferences: structuredClone(shortcutPreferences),
    defaults: structuredClone(shortcutDefaults),
    status: Object.fromEntries(
      shortcutActions.map((action) => [
        action,
        { active: !!shortcutPreferences.bindings[action], error: null },
      ]),
    ),
    cleanupRequired: false,
    warning: null,
  });
  const loginView = () => ({
    status: fixture.loginStatus,
    canChange: !["isolated", "development", "unsupported"].includes(
      fixture.loginStatus,
    ),
    error: null as string | null,
  });
  Reflect.set(window, "isTauri", true);
  Reflect.set(window, "nativeFixture", fixture);
  Reflect.set(window, "__TAURI_INTERNALS__", {
    metadata: {
      currentWindow: { label: "library" },
      currentWebview: { label: "library" },
    },
    transformCallback(callback: (value: unknown) => unknown) {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(command: string, args: Record<string, unknown> = {}) {
      fixture.calls.push(command);
      if (command === "library_location") return info();
      if (command === "get_login_item") return loginView();
      if (command === "open_login_item_settings") return null;
      if (command === "set_login_item") {
        fixture.loginChanges.push(args.enabled as boolean);
        if (fixture.holdLoginChange)
          await new Promise<void>((resolve) => {
            fixture.releaseLoginChange = resolve;
          });
        if (fixture.failLoginChange)
          return {
            ...loginView(),
            error: "Synthetic login item change failed",
          };
        fixture.loginStatus = args.enabled
          ? "requiresApproval"
          : "notRegistered";
        return loginView();
      }
      if (command === "get_shortcuts" || command === "retry_shortcuts")
        return shortcutView();
      if (command === "save_shortcuts") {
        if (fixture.failShortcutSave)
          throw new Error(
            "Synthetic shortcut collision. Previous settings were kept.",
          );
        shortcutPreferences = structuredClone(
          args.preferences as typeof shortcutPreferences,
        );
        fixture.emit("peel-shortcuts-changed", null);
        return shortcutView();
      }
      if (command === "retry_open_library") {
        if (fixture.failRetry) {
          fixture.failRetry = false;
          throw new Error("Synthetic drive is still disconnected");
        }
        fixture.available = true;
        return info();
      }
      if (command === "plugin:event|listen") {
        const id = ++sequence;
        listeners.set(id, {
          event: args.event as string,
          handler: args.handler as number,
        });
        return id;
      }
      if (command === "plugin:event|unlisten") {
        listeners.delete(args.eventId as number);
        return;
      }
      if (command === "list_notes") return [structuredClone(note)];
      if (command === "get_note") return structuredClone(note);
      if (command === "list_placements") return [];
      if (command === "get_setting") return null;
      if (command === "save_note") {
        if (fixture.holdSave)
          await new Promise<void>((resolve) => {
            fixture.releaseSave = resolve;
          });
        if (fixture.failSaves) throw new Error("Synthetic note write failed");
        note = {
          ...structuredClone(args.note as typeof note),
          localRevision: Number(args.expectedRevision) + 1,
        };
        return structuredClone(note);
      }
      if (command === "relocation_ack") {
        fixture.acknowledgements.push({
          operationId: args.operationId as string,
          success: args.success as boolean,
        });
        return;
      }
      if (command === "choose_library_folder") return null;
      return null;
    },
  });
}
