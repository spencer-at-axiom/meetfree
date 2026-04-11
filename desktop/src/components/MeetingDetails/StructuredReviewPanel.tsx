"use client";

import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import type {
  ActionItemReviewItem,
  DecisionReviewItem,
  MeetingSpeakerReviewItem,
  StructuredReviewSnapshot,
} from "@/types/structuredReview";

const REVIEW_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  unreviewed: { bg: "bg-amber-100", text: "text-amber-800", label: "Needs Review" },
  accepted: { bg: "bg-green-100", text: "text-green-700", label: "Accepted" },
  edited: { bg: "bg-blue-100", text: "text-blue-700", label: "Edited" },
  rejected: { bg: "bg-rose-100", text: "text-rose-700", label: "Rejected" },
  suggested: { bg: "bg-slate-100", text: "text-slate-700", label: "Suggested" },
  confirmed: { bg: "bg-green-100", text: "text-green-700", label: "Reviewed" },
};

const REVIEW_ACTION_BUTTONS = [
  { value: "accepted", label: "Accept" },
  { value: "rejected", label: "Reject" },
  { value: "unreviewed", label: "Needs Review" },
] as const;

interface StructuredReviewPanelProps {
  meetingId: string;
  refreshSignal: string;
}

type SortOrder = "none" | "asc" | "desc";
type ReviewActionState = "accepted" | "rejected" | "unreviewed";

interface SortState {
  speakers: SortOrder;
  actionItems: SortOrder;
  decisions: SortOrder;
}

interface MeetingSpeakerDraft {
  display_name_override: string;
  speaker_identity_id: string;
  review_status: string;
}

interface ActionItemDraft {
  title: string;
  owner_display_name: string;
  due_date: string;
  status: string;
  review_status: string;
}

interface DecisionDraft {
  title: string;
  review_status: string;
}

interface EvidenceDescriptor {
  badge: string;
  description: string;
  toneClass: string;
  excerpt: string | null;
  supportingText: string | null;
}

function ReviewStatusBadge({ status }: { status: string }) {
  const style = REVIEW_STATUS_STYLES[status] || REVIEW_STATUS_STYLES.unreviewed;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
      role="status"
      aria-label={`Review status: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

function ReviewActionButtons({
  entityLabel,
  value,
  onChange,
}: {
  entityLabel: string;
  value: ReviewActionState;
  onChange: (nextValue: ReviewActionState) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${entityLabel} review actions`}>
      {REVIEW_ACTION_BUTTONS.map((button) => {
        const isSelected = value === button.value;
        return (
          <button
            key={button.value}
            type="button"
            onClick={() => onChange(button.value)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              isSelected
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
            aria-pressed={isSelected}
          >
            {button.label}
          </button>
        );
      })}
    </div>
  );
}

function SpeakerReviewButtons({
  value,
  onChange,
}: {
  value: "confirmed" | "unreviewed";
  onChange: (nextValue: "confirmed" | "unreviewed") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Speaker review actions">
      <button
        type="button"
        onClick={() => onChange("confirmed")}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "confirmed"
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
        aria-pressed={value === "confirmed"}
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => onChange("unreviewed")}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          value === "unreviewed"
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
        aria-pressed={value === "unreviewed"}
      >
        Needs Review
      </button>
    </div>
  );
}

function EvidencePanel({
  entityLabel,
  descriptor,
}: {
  entityLabel: string;
  descriptor: EvidenceDescriptor;
}) {
  return (
    <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${descriptor.toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">{descriptor.badge}</div>
        <span className="text-[11px] uppercase tracking-wide">Why this was captured</span>
      </div>
      <p className="mt-1 text-slate-700">{descriptor.description}</p>
      {descriptor.excerpt && (
        <blockquote
          className="mt-2 rounded-md border border-white/60 bg-white/70 px-3 py-2 text-slate-800"
          aria-label={`${entityLabel} source excerpt`}
        >
          "{descriptor.excerpt}"
        </blockquote>
      )}
      {descriptor.supportingText && <p className="mt-2 text-slate-600">{descriptor.supportingText}</p>}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatTimeFromMs(value: number | null): string | null {
  if (value === null || value < 0) return null;
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function describeEvidence(
  item: Pick<
    ActionItemReviewItem | DecisionReviewItem,
    "source_excerpt" | "source_start_ms" | "source_end_ms" | "source_transcript_id" | "extraction_method"
  >,
): EvidenceDescriptor {
  const trimmedExcerpt = normalizeText(item.source_excerpt);
  const start = formatTimeFromMs(item.source_start_ms);
  const end = formatTimeFromMs(item.source_end_ms);
  const hasTranscriptEvidence = trimmedExcerpt.length > 0 || item.source_transcript_id !== null;
  const method = item.extraction_method.toLowerCase();
  const isWeakEvidence =
    method.includes("heuristic") || method.includes("markdown") || !hasTranscriptEvidence;

  if (hasTranscriptEvidence) {
    const timingText = start || end ? ` around ${start ?? "unknown"}-${end ?? "unknown"}` : "";
    return {
      badge: isWeakEvidence ? "Transcript hint" : "Transcript-backed evidence",
      description: isWeakEvidence
        ? `This item lines up with transcript evidence${timingText}, but it still needs a quick review before you trust it.`
        : `This item is backed by transcript evidence${timingText}.`,
      toneClass: isWeakEvidence ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50",
      excerpt: trimmedExcerpt || null,
      supportingText: isWeakEvidence
        ? "Accept it if the excerpt matches the meeting intent. Edit or reject it if the wording is off."
        : "You can accept this quickly if the excerpt matches the wording you want to keep.",
    };
  }

  return {
    badge: "Weak evidence",
    description: "This item was inferred from summary structure without a direct transcript excerpt. Review it before accepting.",
    toneClass: "border-amber-200 bg-amber-50",
    excerpt: null,
    supportingText: "If you keep this item, saving edits will mark it as Edited instead of Accepted.",
  };
}

function getReviewActionState(status: string): ReviewActionState {
  if (status === "rejected") return "rejected";
  if (status === "unreviewed") return "unreviewed";
  return "accepted";
}

function hasActionItemMaterialEdits(item: ActionItemReviewItem, draft: ActionItemDraft): boolean {
  return (
    normalizeText(item.title) !== normalizeText(draft.title) ||
    normalizeText(item.owner_display_name) !== normalizeText(draft.owner_display_name) ||
    normalizeText(item.due_date) !== normalizeText(draft.due_date)
  );
}

function hasDecisionMaterialEdits(item: DecisionReviewItem, draft: DecisionDraft): boolean {
  return normalizeText(item.title) !== normalizeText(draft.title);
}

function deriveActionItemReviewStatus(item: ActionItemReviewItem, draft: ActionItemDraft): string {
  if (draft.review_status === "rejected" || draft.review_status === "unreviewed") return draft.review_status;
  if (draft.review_status === "edited" || hasActionItemMaterialEdits(item, draft)) return "edited";
  return "accepted";
}

function deriveDecisionReviewStatus(item: DecisionReviewItem, draft: DecisionDraft): string {
  if (draft.review_status === "rejected" || draft.review_status === "unreviewed") return draft.review_status;
  if (draft.review_status === "edited" || hasDecisionMaterialEdits(item, draft)) return "edited";
  return "accepted";
}

function getSortLabel(order: SortOrder): string {
  if (order === "asc") return "Low-High";
  if (order === "desc") return "High-Low";
  return "Off";
}

export function StructuredReviewPanel({ meetingId, refreshSignal }: StructuredReviewPanelProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<StructuredReviewSnapshot | null>(null);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, MeetingSpeakerDraft>>({});
  const [actionDrafts, setActionDrafts] = useState<Record<string, ActionItemDraft>>({});
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({});
  const [sortState, setSortState] = useState<SortState>({
    speakers: "none",
    actionItems: "none",
    decisions: "none",
  });

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "BUTTON") {
      target.blur();
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!meetingId) return;
    setIsLoading(true);
    try {
      const data = await invoke<StructuredReviewSnapshot>("structured_review_get", { meetingId });
      setSnapshot(data);
      setSpeakerDrafts(
        data.meeting_speakers.reduce<Record<string, MeetingSpeakerDraft>>((acc, row) => {
          acc[row.id] = {
            display_name_override: row.display_name_override ?? "",
            speaker_identity_id: row.speaker_identity_id ?? "",
            review_status: row.review_status ?? "unreviewed",
          };
          return acc;
        }, {}),
      );
      setActionDrafts(
        data.action_items.reduce<Record<string, ActionItemDraft>>((acc, row) => {
          acc[row.id] = {
            title: row.title,
            owner_display_name: row.owner_display_name ?? "",
            due_date: row.due_date ?? "",
            status: row.status ?? "open",
            review_status: row.review_status ?? "unreviewed",
          };
          return acc;
        }, {}),
      );
      setDecisionDrafts(
        data.decisions.reduce<Record<string, DecisionDraft>>((acc, row) => {
          acc[row.id] = {
            title: row.title,
            review_status: row.review_status ?? "unreviewed",
          };
          return acc;
        }, {}),
      );
    } catch (error) {
      toast.error("Failed to load structured review data", { description: getErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  const identities = snapshot?.speaker_identities ?? [];
  const meetingSpeakers = useMemo(
    () => (snapshot?.meeting_speakers ?? []).filter((speaker) => speaker.is_active),
    [snapshot?.meeting_speakers],
  );
  const identityNameById = useMemo(
    () => new Map(identities.map((identity) => [identity.id, identity.display_name])),
    [identities],
  );

  const sortByConfidence = <T extends { match_confidence?: number | null }>(
    items: T[],
    order: SortOrder,
    confidenceKey: keyof T = "match_confidence" as keyof T,
  ): T[] => {
    if (order === "none") return items;
    return [...items].sort((a, b) => {
      const confidenceA = (a[confidenceKey] as number | null) ?? -1;
      const confidenceB = (b[confidenceKey] as number | null) ?? -1;
      return order === "asc" ? confidenceA - confidenceB : confidenceB - confidenceA;
    });
  };

  const sortedSpeakers = useMemo(
    () => sortByConfidence(meetingSpeakers, sortState.speakers),
    [meetingSpeakers, sortState.speakers],
  );
  const sortedActionItems = useMemo(() => snapshot?.action_items ?? [], [snapshot?.action_items]);
  const sortedDecisions = useMemo(() => snapshot?.decisions ?? [], [snapshot?.decisions]);

  const displayedActionStatuses = useMemo(
    () =>
      sortedActionItems.reduce<Record<string, string>>((acc, item) => {
        const draft = actionDrafts[item.id];
        acc[item.id] = draft ? deriveActionItemReviewStatus(item, draft) : item.review_status;
        return acc;
      }, {}),
    [actionDrafts, sortedActionItems],
  );

  const displayedDecisionStatuses = useMemo(
    () =>
      sortedDecisions.reduce<Record<string, string>>((acc, item) => {
        const draft = decisionDrafts[item.id];
        acc[item.id] = draft ? deriveDecisionReviewStatus(item, draft) : item.review_status;
        return acc;
      }, {}),
    [decisionDrafts, sortedDecisions],
  );

  const unreviewedSpeakersCount = useMemo(
    () => sortedSpeakers.filter((speaker) => speaker.review_status === "unreviewed").length,
    [sortedSpeakers],
  );
  const unreviewedActionItemsCount = useMemo(
    () => sortedActionItems.filter((item) => displayedActionStatuses[item.id] === "unreviewed").length,
    [displayedActionStatuses, sortedActionItems],
  );
  const unreviewedDecisionsCount = useMemo(
    () => sortedDecisions.filter((item) => displayedDecisionStatuses[item.id] === "unreviewed").length,
    [displayedDecisionStatuses, sortedDecisions],
  );

  const updateSpeakerDraft = (id: string, patch: Partial<MeetingSpeakerDraft>) => {
    setSpeakerDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };
  const updateActionDraft = (id: string, patch: Partial<ActionItemDraft>) => {
    setActionDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };
  const updateDecisionDraft = (id: string, patch: Partial<DecisionDraft>) => {
    setDecisionDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const openLinkedIdentity = (identityId: string) => {
    if (!identityId.trim()) {
      toast.error("Link the speaker to an identity before opening the identity page");
      return;
    }
    router.push(`/speaker-identities/detail?id=${identityId}`);
  };

  const saveSpeaker = async (speaker: MeetingSpeakerReviewItem) => {
    const draft = speakerDrafts[speaker.id];
    if (!draft) return;

    try {
      await invoke("meeting_speaker_rename_local", {
        meetingSpeakerId: speaker.id,
        displayNameOverride: draft.display_name_override.trim().length > 0 ? draft.display_name_override.trim() : null,
        reviewStatus: draft.review_status,
      });
      await invoke("meeting_speaker_link_identity", {
        meetingSpeakerId: speaker.id,
        speakerIdentityId: draft.speaker_identity_id.trim(),
        reviewStatus: draft.review_status,
      });
      toast.success("Speaker review saved");
      await refresh();
    } catch (error) {
      toast.error("Failed to save speaker review", { description: getErrorMessage(error) });
    }
  };

  const createIdentityForSpeaker = async (speaker: MeetingSpeakerReviewItem) => {
    const draft = speakerDrafts[speaker.id];
    const displayName = draft?.display_name_override?.trim();
    if (!displayName) {
      toast.error("Enter a speaker name before creating an identity");
      return;
    }

    try {
      const identity = await invoke<{ id: string }>("speaker_identity_create", { displayName });
      updateSpeakerDraft(speaker.id, {
        speaker_identity_id: identity.id,
        review_status: "confirmed",
      });
      toast.success("Speaker identity created");
      await refresh();
      router.push(`/speaker-identities/detail?id=${identity.id}`);
    } catch (error) {
      toast.error("Failed to create speaker identity", { description: getErrorMessage(error) });
    }
  };

  const saveActionItem = async (item: ActionItemReviewItem) => {
    const draft = actionDrafts[item.id];
    if (!draft) return;
    if (draft.title.trim().length === 0) {
      toast.error("Action item title cannot be empty");
      return;
    }

    const reviewStatus = deriveActionItemReviewStatus(item, draft);
    try {
      await invoke("action_item_review_update", {
        actionItemId: item.id,
        review: {
          title: draft.title.trim(),
          owner_display_name: draft.owner_display_name.trim().length > 0 ? draft.owner_display_name.trim() : null,
          due_date: draft.due_date.trim().length > 0 ? draft.due_date.trim() : null,
          review_status: reviewStatus,
        },
      });
      await invoke("action_item_status_update", {
        actionItemId: item.id,
        status: draft.status,
      });
      toast.success("Action item saved");
      await refresh();
    } catch (error) {
      toast.error("Failed to save action item", { description: getErrorMessage(error) });
    }
  };

  const saveDecision = async (decision: DecisionReviewItem) => {
    const draft = decisionDrafts[decision.id];
    if (!draft) return;
    if (draft.title.trim().length === 0) {
      toast.error("Decision title cannot be empty");
      return;
    }

    const reviewStatus = deriveDecisionReviewStatus(decision, draft);
    try {
      await invoke("decision_review_update", {
        decisionId: decision.id,
        review: {
          title: draft.title.trim(),
          review_status: reviewStatus,
        },
      });
      toast.success("Decision saved");
      await refresh();
    } catch (error) {
      toast.error("Failed to save decision", { description: getErrorMessage(error) });
    }
  };

  const toggleSort = (section: keyof SortState) => {
    setSortState((prev) => {
      const current = prev[section];
      const next = current === "none" ? "asc" : current === "asc" ? "desc" : "none";
      return { ...prev, [section]: next };
    });
  };

  return (
    <section
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-4"
      onKeyDown={handleKeyDown}
      aria-label="Structured review panel"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Structured Review</h3>
          <p className="mt-1 text-xs text-slate-500">
            Needs Review items are machine-generated. Accept confirms them. Saving content edits marks them as Edited.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          aria-label="Refresh structured review data"
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Meeting Speakers ({sortedSpeakers.length})
            </h4>
            <div className="flex items-center gap-2">
              {unreviewedSpeakersCount > 0 && (
                <span
                  className="text-xs font-medium text-slate-600"
                  role="status"
                  aria-live="polite"
                  aria-label={`${unreviewedSpeakersCount} speakers still need review`}
                >
                  {unreviewedSpeakersCount} need review
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleSort("speakers")}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title={`Sort by confidence: ${getSortLabel(sortState.speakers)}`}
                aria-label={`Sort speakers by confidence. Current: ${sortState.speakers}`}
              >
                Confidence {getSortLabel(sortState.speakers)}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {sortedSpeakers.length === 0 && <p className="text-xs text-slate-500">No meeting speaker records yet.</p>}
            {sortedSpeakers.map((speaker) => {
              const draft = speakerDrafts[speaker.id];
              const effectiveSpeakerStatus = draft?.review_status === "confirmed" ? "confirmed" : "unreviewed";
              const linkedIdentityId = draft?.speaker_identity_id?.trim() ?? "";
              const linkedIdentityName = linkedIdentityId
                ? identityNameById.get(linkedIdentityId) ?? "Open linked identity"
                : null;
              const confidenceText =
                speaker.match_confidence !== null ? `${Math.round(speaker.match_confidence * 100)}% confidence` : "No confidence score";

              return (
                <div
                  key={speaker.id}
                  className="rounded-lg border border-slate-200 p-3"
                  role="article"
                  aria-label={`Speaker ${speaker.diarization_speaker_number !== null ? speaker.diarization_speaker_number : "unnumbered"}, ${REVIEW_STATUS_STYLES[effectiveSpeakerStatus]?.label ?? "Needs Review"}, ${confidenceText}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-slate-700">
                        {speaker.diarization_speaker_number !== null ? `Speaker ${speaker.diarization_speaker_number}` : "Unnumbered speaker"}
                      </div>
                      {speaker.match_confidence !== null && (
                        <ConfidenceIndicator confidence={speaker.match_confidence} displayMode="full" tooltipContext="speaker" />
                      )}
                    </div>
                    <ReviewStatusBadge status={effectiveSpeakerStatus} />
                  </div>

                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <SpeakerReviewButtons
                      value={effectiveSpeakerStatus}
                      onChange={(nextValue) => updateSpeakerDraft(speaker.id, { review_status: nextValue })}
                    />
                    {linkedIdentityId && (
                      <button
                        type="button"
                        onClick={() => openLinkedIdentity(linkedIdentityId)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        aria-label={`Open linked identity ${linkedIdentityName}`}
                      >
                        Open Identity: {linkedIdentityName}
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2 md:grid-cols-[1fr_220px_auto_auto]">
                    <input
                      value={draft?.display_name_override ?? ""}
                      onChange={(event) => updateSpeakerDraft(speaker.id, { display_name_override: event.target.value })}
                      placeholder="Display name"
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Speaker display name"
                    />
                    <select
                      value={draft?.speaker_identity_id ?? ""}
                      onChange={(event) =>
                        updateSpeakerDraft(speaker.id, {
                          speaker_identity_id: event.target.value,
                          review_status: event.target.value ? "confirmed" : draft.review_status,
                        })
                      }
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Link to speaker identity"
                    >
                      <option value="">No linked identity</option>
                      {identities.map((identity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.display_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void createIdentityForSpeaker(speaker)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      aria-label="Create new speaker identity"
                    >
                      Create Identity
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveSpeaker(speaker)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      aria-label="Save speaker changes"
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Action Items ({sortedActionItems.length})
            </h4>
            <div className="flex items-center gap-2">
              {unreviewedActionItemsCount > 0 && (
                <span
                  className="text-xs font-medium text-slate-600"
                  role="status"
                  aria-live="polite"
                  aria-label={`${unreviewedActionItemsCount} action items still need review`}
                >
                  {unreviewedActionItemsCount} need review
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {sortedActionItems.map((item) => {
              const draft = actionDrafts[item.id];
              const effectiveStatus = draft ? deriveActionItemReviewStatus(item, draft) : item.review_status;
              const evidence = describeEvidence(item);
              const hasMaterialEdits = draft ? hasActionItemMaterialEdits(item, draft) : false;

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-200 p-3"
                  role="article"
                  aria-label={`Action item: ${item.title}, ${REVIEW_STATUS_STYLES[effectiveStatus]?.label ?? "Needs Review"}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-700">{item.title}</div>
                    <ReviewStatusBadge status={effectiveStatus} />
                  </div>

                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <ReviewActionButtons
                      entityLabel={`Action item ${item.title}`}
                      value={getReviewActionState(draft?.review_status ?? item.review_status)}
                      onChange={(nextValue) => updateActionDraft(item.id, { review_status: nextValue })}
                    />
                    {hasMaterialEdits && (
                      <span className="text-xs text-slate-500">
                        Saving these edits will mark this item as Edited.
                      </span>
                    )}
                  </div>

                  <EvidencePanel entityLabel={`Action item ${item.title}`} descriptor={evidence} />

                  <div className="grid gap-2 md:grid-cols-[1fr_170px_140px_140px_auto]">
                    <input
                      value={draft?.title ?? ""}
                      onChange={(event) => updateActionDraft(item.id, { title: event.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Action item title"
                    />
                    <input
                      value={draft?.owner_display_name ?? ""}
                      onChange={(event) => updateActionDraft(item.id, { owner_display_name: event.target.value })}
                      placeholder="Owner"
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Action item owner"
                    />
                    <input
                      value={draft?.due_date ?? ""}
                      onChange={(event) => updateActionDraft(item.id, { due_date: event.target.value })}
                      placeholder="Due date"
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Action item due date"
                    />
                    <select
                      value={draft?.status ?? "open"}
                      onChange={(event) => updateActionDraft(item.id, { status: event.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Action item status"
                    >
                      <option value="open">Open</option>
                      <option value="completed">Completed</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void saveActionItem(item)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      aria-label="Save action item changes"
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            })}
            {sortedActionItems.length === 0 && <p className="text-xs text-slate-500">No structured action items found.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Decisions ({sortedDecisions.length})
            </h4>
            <div className="flex items-center gap-2">
              {unreviewedDecisionsCount > 0 && (
                <span
                  className="text-xs font-medium text-slate-600"
                  role="status"
                  aria-live="polite"
                  aria-label={`${unreviewedDecisionsCount} decisions still need review`}
                >
                  {unreviewedDecisionsCount} need review
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {sortedDecisions.map((decision) => {
              const draft = decisionDrafts[decision.id];
              const effectiveStatus = draft ? deriveDecisionReviewStatus(decision, draft) : decision.review_status;
              const evidence = describeEvidence(decision);
              const hasMaterialEdits = draft ? hasDecisionMaterialEdits(decision, draft) : false;

              return (
                <div
                  key={decision.id}
                  className="rounded-lg border border-slate-200 p-3"
                  role="article"
                  aria-label={`Decision: ${decision.title}, ${REVIEW_STATUS_STYLES[effectiveStatus]?.label ?? "Needs Review"}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-700">{decision.title}</div>
                    <ReviewStatusBadge status={effectiveStatus} />
                  </div>

                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <ReviewActionButtons
                      entityLabel={`Decision ${decision.title}`}
                      value={getReviewActionState(draft?.review_status ?? decision.review_status)}
                      onChange={(nextValue) => updateDecisionDraft(decision.id, { review_status: nextValue })}
                    />
                    {hasMaterialEdits && (
                      <span className="text-xs text-slate-500">
                        Saving these edits will mark this decision as Edited.
                      </span>
                    )}
                  </div>

                  <EvidencePanel entityLabel={`Decision ${decision.title}`} descriptor={evidence} />

                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={draft?.title ?? ""}
                      onChange={(event) => updateDecisionDraft(decision.id, { title: event.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      aria-label="Decision title"
                    />
                    <button
                      type="button"
                      onClick={() => void saveDecision(decision)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      aria-label="Save decision changes"
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            })}
            {sortedDecisions.length === 0 && <p className="text-xs text-slate-500">No structured decisions found.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
