import { useNavigate } from "react-router-dom";
import {
  createBoard,
  renameBoard,
  deleteBoard,
  setTemplateVisibility,
  removeTemplate,
  startTemplate,
  setCanvasTags,
  type Canvas,
  type CanvasListPage,
  type TemplateVisibility,
} from "./api";
import { NameDialog, ShareDialog, DeleteCanvasDialog, TemplateDialog, TagDialog } from "./ui";

export type DashboardDialog =
  | { type: "create" }
  | { type: "rename" | "share" | "delete" | "template" | "start-template" | "tags"; canvas: Canvas };

export default function DashboardDialogs({
  dialog,
  dashboard,
  close,
  refresh,
  setPage,
  notify,
}: {
  dialog: DashboardDialog | null;
  dashboard: string;
  close: () => void;
  refresh: () => void;
  setPage: (update: (page: CanvasListPage) => CanvasListPage) => void;
  notify: (message: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      {dialog?.type === "create" && (
        <NameDialog
          title="Create canvas"
          initial="Untitled canvas"
          close={close}
          action={async (name) => {
            const canvas = await createBoard(name);
            navigate(`/b/${canvas.id}`, { state: { dashboard } });
          }}
        />
      )}
      {dialog?.type === "start-template" && (
        <NameDialog
          title="Name your canvas"
          submitLabel="Start canvas"
          initial={`Untitled canvas (based on template ${dialog.canvas.name})`}
          close={close}
          action={async (name) => {
            const copy = await startTemplate(dialog.canvas.id, name);
            navigate(`/b/${copy.id}`, { state: { dashboard: `/?filter=templates` } });
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <NameDialog
          title="Rename canvas"
          initial={dialog.canvas.name}
          close={close}
          action={async (name) => {
            await renameBoard(dialog.canvas.id, name);
            close();
            refresh();
          }}
        />
      )}
      {dialog?.type === "share" && (
        <ShareDialog id={dialog.canvas.id} name={dialog.canvas.name} close={close} />
      )}
      {dialog?.type === "tags" && (
        <TagDialog
          name={dialog.canvas.name}
          initial={dialog.canvas.tags}
          close={close}
          save={async (tags) => {
            await setCanvasTags(dialog.canvas.id, tags);
            close();
            refresh();
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteCanvasDialog
          name={dialog.canvas.name}
          close={close}
          action={async () => {
            const id = dialog.canvas.id;
            await deleteBoard(id);
            close();
            notify("Canvas deleted.");
            setPage((previous) => ({
              ...previous,
              items: previous.items.filter((canvas) => canvas.id !== id),
            }));
            refresh();
          }}
        />
      )}
      {dialog?.type === "template" && (
        <TemplateDialog
          name={dialog.canvas.name}
          visibility={dialog.canvas.templateVisibility ?? null}
          close={close}
          save={async (visibility: TemplateVisibility) => {
            const canvas = dialog.canvas;
            await setTemplateVisibility(canvas.id, visibility);
            close();
            setPage((previous) => ({
              ...previous,
              items: previous.items.map((item) =>
                item.id === canvas.id ? { ...item, templateVisibility: visibility } : item
              ),
            }));
            refresh();
          }}
          remove={
            dialog.canvas.templateVisibility
              ? async () => {
                  const canvas = dialog.canvas;
                  await removeTemplate(canvas.id);
                  close();
                  setPage((previous) => ({
                    ...previous,
                    items: previous.items.map((item) =>
                      item.id === canvas.id ? { ...item, templateVisibility: null } : item
                    ),
                  }));
                  refresh();
                }
              : null
          }
        />
      )}
    </>
  );
}
