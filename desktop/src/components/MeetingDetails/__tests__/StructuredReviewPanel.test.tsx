import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredReviewPanel } from '../StructuredReviewPanel';
import type { StructuredReviewSnapshot } from '@/types/structuredReview';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const snapshot: StructuredReviewSnapshot = {
  meeting_speakers: [
    {
      id: 'speaker-1',
      meeting_id: 'meeting-1',
      diarization_speaker_number: 1,
      display_name_override: 'Speaker 1',
      speaker_identity_id: 'identity-1',
      review_status: 'unreviewed',
      match_confidence: 0.85,
      is_active: true,
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
      last_reviewed_at: null,
      last_generated_at: null,
    },
    {
      id: 'speaker-2',
      meeting_id: 'meeting-1',
      diarization_speaker_number: 2,
      display_name_override: 'Speaker 2',
      speaker_identity_id: 'identity-2',
      review_status: 'confirmed',
      match_confidence: 0.45,
      is_active: true,
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
      last_reviewed_at: null,
      last_generated_at: null,
    },
  ],
  action_items: [
    {
      id: 'action-1',
      meeting_id: 'meeting-1',
      title: 'Prepare launch plan',
      details: null,
      owner_speaker_identity_id: null,
      owner_display_name: 'Alex',
      due_date: '2026-04-20',
      status: 'open',
      review_status: 'unreviewed',
      source_transcript_id: 'segment-1',
      source_start_ms: 61000,
      source_end_ms: 73000,
      source_excerpt: 'Alex will prepare the launch plan before next Friday.',
      extraction_method: 'summary_structured',
      extraction_version: 'v0.4.0',
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
    },
  ],
  decisions: [
    {
      id: 'decision-1',
      meeting_id: 'meeting-1',
      title: 'Ship beta behind a flag',
      details: null,
      review_status: 'unreviewed',
      source_transcript_id: null,
      source_start_ms: null,
      source_end_ms: null,
      source_excerpt: null,
      extraction_method: 'markdown_heuristic',
      extraction_version: 'v0.4.0',
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
    },
    {
      id: 'decision-2',
      meeting_id: 'meeting-1',
      title: 'Hire new team member',
      details: null,
      review_status: 'edited',
      source_transcript_id: 'segment-2',
      source_start_ms: 14000,
      source_end_ms: 19000,
      source_excerpt: 'We should hire a new team member for support.',
      extraction_method: 'summary_structured',
      extraction_version: 'v0.4.0',
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
    },
  ],
  speaker_identities: [
    {
      id: 'identity-1',
      display_name: 'Alex',
      normalized_name: 'alex',
      notes: null,
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
      archived_at: null,
    },
    {
      id: 'identity-2',
      display_name: 'Jordan',
      normalized_name: 'jordan',
      notes: null,
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
      archived_at: null,
    },
  ],
};

function renderPanel() {
  return render(<StructuredReviewPanel meetingId="meeting-1" refreshSignal="seed" />);
}

describe('StructuredReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'structured_review_get') return snapshot;
      if (
        command === 'meeting_speaker_rename_local' ||
        command === 'meeting_speaker_link_identity' ||
        command === 'speaker_identity_create' ||
        command === 'action_item_review_update' ||
        command === 'action_item_status_update' ||
        command === 'decision_review_update'
      ) {
        return command === 'speaker_identity_create' ? { id: 'identity-new' } : true;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it('loads review data and shows user-facing review labels', async () => {
    renderPanel();

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('structured_review_get', { meetingId: 'meeting-1' });
    });

    const badges = screen.getAllByLabelText(/Review status:/);
    const labels = badges.map((badge) => badge.textContent?.trim());
    expect(labels).toContain('Needs Review');
    expect(labels).toContain('Reviewed');
    expect(labels).toContain('Edited');
  });

  it('shows explicit review actions and transcript evidence', async () => {
    renderPanel();

    const actionArticle = await screen.findByRole('article', { name: /Action item: Prepare launch plan/ });
    expect(within(actionArticle).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(within(actionArticle).getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(within(actionArticle).getByText('Transcript-backed evidence')).toBeTruthy();
    expect(
      within(actionArticle).getByLabelText('Action item Prepare launch plan source excerpt').textContent,
    ).toContain('Alex will prepare the launch plan before next Friday.');

    const decisionArticle = await screen.findByRole('article', { name: /Decision: Ship beta behind a flag/ });
    expect(within(decisionArticle).getByText('Weak evidence')).toBeTruthy();
  });

  it('saves edited action items as edited even after selecting accept', async () => {
    renderPanel();

    const actionArticle = await screen.findByRole('article', { name: /Action item: Prepare launch plan/ });
    fireEvent.click(within(actionArticle).getByRole('button', { name: 'Accept' }));
    fireEvent.change(within(actionArticle).getByLabelText('Action item title'), {
      target: { value: 'Prepare launch plan reviewed' },
    });
    fireEvent.click(within(actionArticle).getByRole('button', { name: 'Save action item changes' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('action_item_review_update', {
        actionItemId: 'action-1',
        review: {
          title: 'Prepare launch plan reviewed',
          owner_display_name: 'Alex',
          due_date: '2026-04-20',
          review_status: 'edited',
        },
      });
    });
  });

  it('saves rejected decisions with explicit review state', async () => {
    renderPanel();

    const decisionArticle = await screen.findByRole('article', { name: /Decision: Ship beta behind a flag/ });
    fireEvent.click(within(decisionArticle).getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(decisionArticle).getByRole('button', { name: 'Save decision changes' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('decision_review_update', {
        decisionId: 'decision-1',
        review: {
          title: 'Ship beta behind a flag',
          review_status: 'rejected',
        },
      });
    });
  });

  it('passes explicit speaker review state through save commands', async () => {
    renderPanel();

    const speakerArticle = await screen.findByRole('article', { name: /Speaker 1, Needs Review, 85% confidence/ });
    fireEvent.change(within(speakerArticle).getByLabelText('Speaker display name'), {
      target: { value: 'Jordan Speaker' },
    });
    fireEvent.click(within(speakerArticle).getByRole('button', { name: 'Confirm' }));
    fireEvent.click(within(speakerArticle).getByRole('button', { name: 'Save speaker changes' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('meeting_speaker_rename_local', {
        meetingSpeakerId: 'speaker-1',
        displayNameOverride: 'Jordan Speaker',
        reviewStatus: 'confirmed',
      });
    });

    expect(mocks.invoke).toHaveBeenCalledWith('meeting_speaker_link_identity', {
      meetingSpeakerId: 'speaker-1',
      speakerIdentityId: 'identity-1',
      reviewStatus: 'confirmed',
    });
  });

  it('quick-opens linked identities from speaker rows', async () => {
    renderPanel();

    const speakerArticle = await screen.findByRole('article', { name: /Speaker 1, Needs Review, 85% confidence/ });
    fireEvent.click(within(speakerArticle).getByRole('button', { name: 'Open linked identity Alex' }));

    expect(mocks.push).toHaveBeenCalledWith('/speaker-identities/detail?id=identity-1');
  });

  it('cycles speaker confidence sort labels', async () => {
    renderPanel();

    const sortButton = await screen.findByRole('button', { name: /Sort speakers by confidence/ });
    expect(sortButton.textContent).toContain('Confidence Off');
    fireEvent.click(sortButton);
    expect(sortButton.textContent).toContain('Confidence Low-High');
    fireEvent.click(sortButton);
    expect(sortButton.textContent).toContain('Confidence High-Low');
  });
});
