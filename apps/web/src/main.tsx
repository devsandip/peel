import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Note } from "@peel/core";
import { repository, native } from "@peel/storage";
import { Library } from "./library";
import { NoteEditor } from "./note";
import { invoke } from "./platform";
import { NativeLibraryGate } from "./native-library";
import "./styles.css";
import { startOfflineShell } from "./offline-shell";
function App() {
  const id = new URLSearchParams(location.search).get("note");
  const [note, setNote] = useState<Note | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError("");
    if (id)
      void repository
        .get(id)
        .then((note) => {
          if (note) setNote(note);
          else setError("This note is no longer available.");
        })
        .catch((e) => setError(String(e)));
  }, [id, attempt]);
  if (id && native)
    return note ? (
      <NoteEditor initial={note} onClose={() => {}} />
    ) : (
      <div className="startup-state" role={error ? "alert" : "status"}>
        {error ? (
          <>
            <h2>Could not open this note</h2>
            <p>{error}</p>
            <button onClick={() => setAttempt((x) => x + 1)}>Retry</button>{" "}
            <button onClick={() => void invoke("open_library")}>
              Open Notes Library
            </button>
          </>
        ) : (
          "Opening your note…"
        )}
      </div>
    );
  return <Library />;
}
createRoot(document.getElementById("root")!).render(
  <NativeLibraryGate>
    <App />
  </NativeLibraryGate>,
);
startOfflineShell();
