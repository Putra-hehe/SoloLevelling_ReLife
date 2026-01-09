import { describe, expect, it } from "vitest";
import { sanitizeForFirestore } from "./firestore";

describe("sanitizeForFirestore", () => {
  it("removes undefined fields and preserves nested data", () => {
    const input = {
      user: { id: "u1", name: "Hero", email: undefined },
      quests: [{ id: "q1", title: "Quest", dueDate: undefined }],
      moodByDate: undefined,
      metadata: {
        lastSync: null,
        flags: [true, undefined, false],
      },
    };

    expect(sanitizeForFirestore(input)).toEqual({
      user: { id: "u1", name: "Hero" },
      quests: [{ id: "q1", title: "Quest" }],
      metadata: {
        lastSync: null,
        flags: [true, false],
      },
    });
  });
});
