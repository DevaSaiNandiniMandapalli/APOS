import { describe, expect, it } from "vitest";
import {
  ANNOTATION_HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitHistory,
  commitHistorySince,
  createHistory,
  redoHistory,
  replaceHistoryPresent,
  undoHistory,
} from "./annotation-history";

describe("annotation history", () => {
  it("starts with no undo or redo entries", () => {
    const history = createHistory(["empty"]);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
  });

  it("restores annotation creation, editing, movement and deletion states", () => {
    const empty = { annotations: [] as string[], comments: [] as string[] };
    const created = { annotations: ["rectangle"], comments: [] };
    const edited = { annotations: ["rectangle:red"], comments: [] };
    const moved = { annotations: ["rectangle:red@0.5,0.5"], comments: [] };
    const deleted = { annotations: [] as string[], comments: ["page note"] };

    let history = createHistory(empty);
    for (const document of [created, edited, moved, deleted]) {
      history = commitHistory(history, document);
    }

    expect(canUndo(history)).toBe(true);
    expect(history.present).toBe(deleted);

    history = undoHistory(history);
    expect(history.present).toBe(moved);
    history = undoHistory(history);
    expect(history.present).toBe(edited);
    history = undoHistory(history);
    expect(history.present).toBe(created);
    history = undoHistory(history);
    expect(history.present).toBe(empty);
    expect(canUndo(history)).toBe(false);

    history = redoHistory(history);
    expect(history.present).toBe(created);
    history = redoHistory(history);
    expect(history.present).toBe(edited);
    expect(canRedo(history)).toBe(true);
  });

  it("clears the redo branch after a new change", () => {
    const history = createHistory("initial");
    const changed = commitHistory(history, "first");
    const undone = undoHistory(changed);
    expect(undone.present).toBe("initial");
    expect(canRedo(undone)).toBe(true);

    const replacement = commitHistory(undone, "replacement");
    expect(replacement.present).toBe("replacement");
    expect(canRedo(replacement)).toBe(false);
    expect(replacement.past).toEqual(["initial"]);
  });

  it("groups live edits into one undo step", () => {
    const initial = { annotations: ["box"] };
    const review = commitHistory(createHistory(initial), { annotations: ["box", "note"] });

    const liveEdit = replaceHistoryPresent(review, { annotations: ["box", "note edited"] });
    expect(liveEdit.present).toEqual({ annotations: ["box", "note edited"] });
    expect(liveEdit.past).toEqual([initial]);

    const committed = commitHistorySince(liveEdit, review.present);
    expect(committed.past).toEqual([initial, review.present]);
    expect(undoHistory(committed).present).toBe(review.present);
  });

  it("ignores no-op commits and keeps the history bounded", () => {
    const history = createHistory(0);
    expect(commitHistory(history, 0)).toBe(history);

    let bounded = createHistory(-1);
    for (let value = 0; value < ANNOTATION_HISTORY_LIMIT + 20; value += 1) {
      bounded = commitHistory(bounded, value);
    }

    expect(bounded.past).toHaveLength(ANNOTATION_HISTORY_LIMIT);
    expect(bounded.past[0]).toBe(19);
    expect(bounded.present).toBe(ANNOTATION_HISTORY_LIMIT + 19);
  });
});
