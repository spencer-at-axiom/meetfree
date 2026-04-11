import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakerIdentityInspector } from '../[id]/SpeakerIdentityInspector';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=identity-1'),
  useRouter: () => ({ push: mocks.push }),
}));

function buildDetail() {
  return {
    identity: {
      id: 'identity-1',
      display_name: 'Alice Johnson',
      normalized_name: 'alice johnson',
      notes: 'Design lead',
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-11T00:00:00Z',
      archived_at: null,
    },
    meetings: [
      {
        meeting_id: 'meeting-1',
        meeting_title: 'Sprint Planning',
        meeting_date: '2026-04-11T00:00:00Z',
        speaker_display_name: 'Alice',
        meeting_speaker_id: 'meeting-speaker-1',
      },
    ],
    action_items: [
      {
        id: 'action-1',
        meeting_id: 'meeting-1',
        title: 'Review architecture notes',
        details: 'Focus on the migration section',
        owner_display_name: 'Alice',
        due_date: '2026-04-15',
        status: 'open',
        review_status: 'accepted',
        created_at: '2026-04-11T00:00:00Z',
        meeting_title: 'Sprint Planning',
        meeting_date: '2026-04-11T00:00:00Z',
      },
    ],
    voice_profiles: [
      {
        id: 'voice-profile-1',
        speaker_identity_id: 'identity-1',
        profile_kind: 'manual',
        provider: 'reviewer',
        model_version: 'notes-v1',
        sample_count: 2,
        profile_payload: 'Warm-up sample notes',
        created_at: '2026-04-11T00:00:00Z',
        updated_at: '2026-04-11T00:00:00Z',
        last_trained_at: null,
      },
    ],
    meeting_count: 1,
    action_item_count: 1,
  };
}

describe('SpeakerIdentityInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(buildDetail());
  });

  it('loads identity details and reveals grouped action items', async () => {
    render(<SpeakerIdentityInspector />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identity_inspect', {
        identityId: 'identity-1',
      });
    });

    expect(screen.getByText('Alice Johnson')).toBeTruthy();
    expect(screen.getByLabelText('1 meetings')).toBeTruthy();
    expect(screen.getByLabelText('1 action items')).toBeTruthy();
    expect(screen.getByLabelText('1 voice profiles')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all action items' }));

    expect(screen.getByText('Review architecture notes')).toBeTruthy();
    expect(screen.getByText('Focus on the migration section')).toBeTruthy();
  });

  it('saves trimmed identity updates and clears notes', async () => {
    const refreshedDetail = {
      ...buildDetail(),
      identity: {
        ...buildDetail().identity,
        display_name: 'Alice Johnson Prime',
        notes: null,
      },
    };

    mocks.invoke
      .mockResolvedValueOnce(buildDetail())
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(refreshedDetail);

    render(<SpeakerIdentityInspector />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit identity details' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit identity details' }));
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: '  Alice Johnson Prime  ' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identity_update', {
        identityId: 'identity-1',
        displayName: 'Alice Johnson Prime',
        notes: null,
      });
    });

    expect(screen.getByText('Alice Johnson Prime')).toBeTruthy();
  });

  it('creates a new voice profile from the inspector', async () => {
    const refreshedDetail = {
      ...buildDetail(),
      voice_profiles: [
        ...buildDetail().voice_profiles,
        {
          id: 'voice-profile-2',
          speaker_identity_id: 'identity-1',
          profile_kind: 'embedding_v1',
          provider: 'local-embedder',
          model_version: 'embed-v1',
          sample_count: 4,
          profile_payload: '{"note":"captured"}',
          created_at: '2026-04-11T00:00:00Z',
          updated_at: '2026-04-11T00:00:00Z',
          last_trained_at: '2026-04-11T00:00:00Z',
        },
      ],
    };

    mocks.invoke
      .mockResolvedValueOnce(buildDetail())
      .mockResolvedValueOnce({ id: 'voice-profile-2' })
      .mockResolvedValueOnce(refreshedDetail);

    render(<SpeakerIdentityInspector />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add voice profile' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add voice profile' }));
    const newProfileForm = screen.getByRole('form', { name: 'New voice profile' });

    fireEvent.change(within(newProfileForm).getByLabelText('Provider'), {
      target: { value: ' local-embedder ' },
    });
    fireEvent.change(within(newProfileForm).getByLabelText('Model Version'), {
      target: { value: ' embed-v1 ' },
    });
    fireEvent.change(within(newProfileForm).getByLabelText('Sample Count'), {
      target: { value: '4' },
    });
    fireEvent.change(within(newProfileForm).getByLabelText('Payload or Notes'), {
      target: { value: ' {"note":"captured"} ' },
    });
    fireEvent.change(within(newProfileForm).getByLabelText('Profile Type'), {
      target: { value: 'embedding_v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new voice profile' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identity_add_voice_profile', {
        identityId: 'identity-1',
        profile: {
          profile_kind: 'embedding_v1',
          provider: 'local-embedder',
          model_version: 'embed-v1',
          sample_count: 4,
          profile_payload: '{"note":"captured"}',
        },
      });
    });

    expect(screen.getAllByText('Embedding v1').length).toBeGreaterThan(0);
  });

  it('updates and deletes an existing voice profile', async () => {
    mocks.invoke
      .mockResolvedValueOnce(buildDetail())
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(buildDetail())
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ...buildDetail(), voice_profiles: [] });

    render(<SpeakerIdentityInspector />);

    await waitFor(() => {
      expect(screen.getByRole('listitem', { name: 'Voice profile manual voice-profile-1' })).toBeTruthy();
    });

    const existingProfile = screen.getByRole('listitem', {
      name: 'Voice profile manual voice-profile-1',
    });

    fireEvent.change(within(existingProfile).getByLabelText('Provider'), {
      target: { value: 'embedding-service' },
    });
    fireEvent.change(within(existingProfile).getByLabelText('Model Version'), {
      target: { value: 'embed-v2' },
    });
    fireEvent.change(within(existingProfile).getByLabelText('Sample Count'), {
      target: { value: '5' },
    });
    fireEvent.click(
      within(existingProfile).getByRole('button', {
        name: 'Save voice profile voice-profile-1',
      }),
    );

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identity_update_voice_profile', {
        voiceProfileId: 'voice-profile-1',
        profile: {
          profile_kind: 'manual',
          provider: 'embedding-service',
          model_version: 'embed-v2',
          sample_count: 5,
          profile_payload: 'Warm-up sample notes',
        },
      });
    });

    const refreshedProfile = await screen.findByRole('listitem', {
      name: 'Voice profile manual voice-profile-1',
    });

    fireEvent.click(
      within(refreshedProfile).getByRole('button', {
        name: 'Delete voice profile voice-profile-1',
      }),
    );

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identity_delete_voice_profile', {
        voiceProfileId: 'voice-profile-1',
      });
    });
  });
});
