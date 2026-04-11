import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakerIdentitiesManager } from '../SpeakerIdentitiesManager';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
}));

const identities = [
  {
    identity: {
      id: 'identity-1',
      display_name: 'Alice Johnson',
      normalized_name: 'alice johnson',
      notes: 'Design lead',
      created_at: '2026-04-11T00:00:00Z',
      updated_at: '2026-04-13T00:00:00Z',
      archived_at: null,
    },
    meeting_count: 5,
    action_item_count: 2,
  },
  {
    identity: {
      id: 'identity-2',
      display_name: 'Jordan Smith',
      normalized_name: 'jordan smith',
      notes: 'Owns budget follow-ups',
      created_at: '2026-04-10T00:00:00Z',
      updated_at: '2026-04-12T00:00:00Z',
      archived_at: null,
    },
    meeting_count: 2,
    action_item_count: 6,
  },
];

describe('SpeakerIdentitiesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(identities);
  });

  it('filters identities by search and shows visible count', async () => {
    render(<SpeakerIdentitiesManager />);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('speaker_identities_list_with_counts');
    });

    fireEvent.change(screen.getByLabelText('Search speaker identities'), {
      target: { value: 'budget' },
    });

    expect(screen.getByLabelText('Visible identity count').textContent).toContain('Showing 1 of 2');
    expect(screen.getByText('Jordan Smith')).toBeTruthy();
    expect(screen.queryByText('Alice Johnson')).toBeNull();
  });

  it('sorts identities and quick-opens the identity inspector', async () => {
    render(<SpeakerIdentitiesManager />);

    await screen.findByText('Alice Johnson');

    fireEvent.change(screen.getByLabelText('Sort speaker identities'), {
      target: { value: 'action_items' },
    });

    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]).getByText('Jordan Smith')).toBeTruthy();

    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Open details for Jordan Smith' }));
    expect(mocks.push).toHaveBeenCalledWith('/speaker-identities/detail?id=identity-2');
  });
});
