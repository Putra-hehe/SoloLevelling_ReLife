import { useEffect, useState } from "react";
import { Quest, Subtask, QuestDifficulty } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
// Mobile detection hook
import { useIsMobile } from "./ui/use-mobile";
import { Badge } from "./ui/badge";
import { Plus, X } from "lucide-react";
import { getXPForDifficulty } from "../utils/xp";
import { createId } from "../utils/id"; // ✅ fallback ID untuk mobile
import { isoToLocalDateKey, makeDueDateISO } from "../utils/date";

interface QuestCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (quest: Quest) => void;
  defaultDueDate?: string;
}

// ✅ Validasi difficulty biar gak crash kalau value aneh
const DIFFICULTIES = ["easy", "normal", "hard"] as const;

function toDifficulty(v: unknown): QuestDifficulty {
  if (typeof v !== "string") return "normal";
  return (DIFFICULTIES as readonly string[]).includes(v)
    ? (v as QuestDifficulty)
    : "normal";
}

export function QuestCreateDialog({
  open,
  onClose,
  onCreate,
  defaultDueDate,
}: QuestCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<QuestDifficulty>("normal");
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");

  useEffect(() => {
    if (!open) return;
    if (defaultDueDate) {
      setDueDate(defaultDueDate);
    }
  }, [open, defaultDueDate]);

  useEffect(() => {
    if (open) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ✅ xpReward aman karena difficulty selalu tervalidasi
  const xpReward = getXPForDifficulty(difficulty);

  // Detect if running on a small mobile viewport. When true, fall back to native
  // <select> element for better compatibility. The Radix Select component can
  // sometimes cause blank screens on certain mobile browsers. Using a native
  // select avoids those issues.
  const isMobile = useIsMobile();

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setNewTag("");
      return;
    }
    setTags([...tags, trimmed]);
    setNewTag("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleAddSubtask = () => {
    const trimmed = newSubtask.trim();
    if (!trimmed) return;

    const subtask: Subtask = {
      id: createId("subtask"), // ✅ lebih aman dari Date.now di mobile rapid taps
      title: trimmed,
      completed: false,
    };

    setSubtasks([...subtasks, subtask]);
    setNewSubtask("");
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks(
      subtasks.map((st) =>
        st.id === id ? { ...st, completed: !st.completed } : st
      )
    );
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  function resetForm() {
    setTitle("");
    setDescription("");
    setDifficulty("normal");
    setDueDate(undefined);
    setTags([]);
    setNewTag("");
    setSubtasks([]);
    setNewSubtask("");
  }

  const handleCreate = () => {
    const quest: Quest = {
      id: createId("quest"), // ✅ FIX: crypto.randomUUID() bikin blank di sebagian HP
      title: title.trim() || "Untitled Quest",
      description: description.trim() || undefined,
      difficulty,
      status: "pending",
      xpReward,
      dueDate,
      tags,
      subtasks,
      createdAt: new Date().toISOString(),
    };

    onCreate(quest);
    resetForm();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Quest</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="new-quest-title">Title</Label>
            <Input
              id="new-quest-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quest name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="new-quest-description">Description</Label>
            <Textarea
              id="new-quest-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Quest description"
              rows={3}
            />
          </div>

          {/* Difficulty & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Difficulty</Label>
              {isMobile ? (
                // On mobile devices use the native select element. Native selects
                // avoid blank-page issues that can occur with Radix Select on
                // some mobile browsers.
                <select
                  className="border-input bg-input-background rounded-md w-full h-9 px-3 py-2 text-sm"
                  value={difficulty}
                  onChange={(e) => {
                    setDifficulty(toDifficulty(e.target.value));
                  }}
                >
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </select>
              ) : (
                <Select
                  value={difficulty}
                  onValueChange={(value) => {
                    setDifficulty(toDifficulty(value));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-quest-due-date">Due Date</Label>
              <Input
                id="new-quest-due-date"
                type="date"
                // IMPORTANT: use local date (not UTC) to avoid off-by-one-day issues
                // that make new quests "disappear" from Today tab on some desktops/timezones.
                value={(dueDate ? isoToLocalDateKey(dueDate) : null) || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    setDueDate(undefined);
                    return;
                  }
                  const [yy, mm, dd] = v.split("-").map((n) => parseInt(n, 10));
                  // Construct a local date (year, month-1, day) and anchor at local noon.
                  const localDate = new Date(yy, (mm || 1) - 1, dd || 1);
                  setDueDate(makeDueDateISO(localDate));
                }}
              />
            </div>
          </div>

          {/* XP Reward preview */}
          <div className="text-sm text-muted-foreground">
            XP Reward: <span className="font-medium">{xpReward}</span>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add a tag"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <Button onClick={handleAddTag} size="sm" type="button">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {tags.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Subtasks */}
          <div className="space-y-2">
            <Label>Subtasks</Label>
            <div className="flex gap-2">
              <Input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="Add a subtask"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSubtask();
                  }
                }}
              />
              <Button onClick={handleAddSubtask} size="sm" type="button">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {subtasks.length > 0 && (
              <div className="space-y-2 mt-3">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="flex items-center justify-between gap-2 border border-border rounded p-2"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleSubtask(subtask.id)}
                        className="w-5 h-5 flex items-center justify-center border border-border rounded-full bg-background"
                      >
                        {subtask.completed ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4 text-primary"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : null}
                      </button>
                      <span
                        className={
                          subtask.completed
                            ? "line-through text-muted-foreground"
                            : ""
                        }
                      >
                        {subtask.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSubtask(subtask.id)}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 mt-6">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                resetForm();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              className="bg-gradient-to-r from-purple-500 to-cyan-500 text-white"
            >
              Create Quest
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
      