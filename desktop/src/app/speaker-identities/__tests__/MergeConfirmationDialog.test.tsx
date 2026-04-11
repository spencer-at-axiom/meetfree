import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeConfirmationDialog } from '../MergeConfirmationDialog';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

const source = {
  identity: {
    id: 'identity-source',
    display_name: 'John Doe',
    normalized_name: 'john doe',
    notes: null,
    created_at: '2026-04-11T00:00:00Z',
    updated_at: '2026-04-11T00:00:00Z',
    archived_at: null,
  },
  meeting_count: 2,
  action_item_count: 3,
};

const target = {
  identity: {
    id: 'identity-target',
    display_name: 'John D.',
    normalized_name: 'john d',
    notes: null,
    created_at: '2026-04-11T00:00:00Z',
    updated_at: '2026-04-11T00:00:00Z',
    archived_at: null,
  },
  meeting_count: 5,
  action_item_count: 6,
};

describe('MergeConfirmationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes identity merge and shows the success summary', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    mocks.invoke.mockResolvedValue({
      meeting_speakers_updated: 2,
      action_items_updated: 3,
      voice_profiles_updated: 1,
    });

    render(
      <MergeConfirmationDialog
        source={source}
        target={target}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge operation' }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identities_merge', {
        sourceIdentityId: 'identity-source',
        targetIdentityId: 'identity-target',
      });
    });

    expect(screen.getByText('Merge completed successfully!')).toBeTruthy();
    expect(screen.getByText('2 meeting speakers updated')).toBeTruthy();
    expect(screen.getByText('3 action items updated')).toBeTruthy();
    expect(screen.getByText('1 voice profiles updated')).toBeTruthy();

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    }, { timeout: 2500 });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
