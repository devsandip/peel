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
  useEffect(() => {
    let active = true;
    const unsubscribe = upload.subscribe(() => {
      if (active) setRevision((previous) => previous + 1);
    });
    void upload.upload();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [upload]);
  const view = upload.snapshot();
  return (
    <>
      <CloudNoteEditor
        session={upload.session}
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
        onPutAway={(session) => {
          // Retention has finished; the window never waits for Cloud response.
          void upload.upload();
          return onPutAway(session);
        }}
      />
    </>
  );
}
