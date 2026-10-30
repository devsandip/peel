import { useEffect, useState } from "react";
import { CloudNoteEditor } from "./cloud-note-editor";
import type { CloudNoteUpload } from "./cloud-note-upload";
import type { CloudDraftSession } from "./cloud-draft-session";

/** Explicit authenticated composition only; no default route or auth grant. */
export function CloudUploadingNoteEditor({
  upload,
  onPutAway,
}: {
  upload: CloudNoteUpload;
  onPutAway: (session: CloudDraftSession) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState({ upload, key: 0 });
  if (selected.upload !== upload) {
    setSelected({ upload, key: selected.key + 1 });
    return null;
  }
  return (
    <SelectedUploadEditor
      key={selected.key}
      upload={upload}
      onPutAway={onPutAway}
    />
  );
}
function SelectedUploadEditor({
  upload,
  onPutAway,
}: {
  upload: CloudNoteUpload;
  onPutAway: (session: CloudDraftSession) => void | Promise<void>;
}) {
  const [revision, setRevision] = useState(0);
  const session = upload.session;
  useEffect(() => {
    let active = true;
    const unsubscribe = upload.subscribe(() => {
      if (active) setRevision((previous) => previous + 1);
    });
    // Session identity can advance between rendering and installing this subscription.
    if (upload.session !== session) setRevision((previous) => previous + 1);
    const initial = upload.snapshot();
    if (initial.kind === "idle" || initial.kind === "uploading")
      void upload.upload();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [upload, session]);
  const view = upload.snapshot();
  return (
    <>
      <CloudNoteEditor
        session={session}
        refreshKey={revision}
        uploadNotice={
          view.message
            ? {
                message: view.message,
                onRetry: () => {
                  void upload.upload();
                },
              }
            : undefined
        }
        onRetained={() => {
          upload.schedule();
        }}
        onPutAway={async (session) => {
          // A new flush would temporarily invalidate the retained acknowledgement.
          await onPutAway(session);
          // The parent owns the closed view; Cloud response never blocks dismissal.
          void upload.upload();
        }}
      />
    </>
  );
}
