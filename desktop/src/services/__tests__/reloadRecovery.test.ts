import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBService } from '@/services/indexedDBService';

const DB_NAME = 'MeetFreeRecoveryDB';

async function deleteDatabase(): Promise<void> {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => resolve(undefined);
    req.onblocked = () => resolve(undefined);
  });
}

describe('Reload-during-recording recovery', () => {
  let service: IndexedDBService;

  beforeEach(async () => {
    await deleteDatabase();
    vi.restoreAllMocks();
    service = new IndexedDBService();
    await service.init();
  });

  it('persists meeting metadata before reload and recovers after', async () => {
    await service.saveMeetingMetadata({
      meetingId: 'reload-test-1',
      title: 'In-progress Meeting',
      startTime: Date.now(),
      lastUpdated: Date.now(),
      transcriptCount: 0,
      savedToSQLite: false,
    });

    const freshService = new IndexedDBService();
    await freshService.init();
    const metadata = await freshService.getMeetingMetadata('reload-test-1');

    expect(metadata).not.toBeNull();
    expect(metadata?.title).toBe('In-progress Meeting');
    expect(metadata?.savedToSQLite).toBe(false);
  });

  it('recovers transcripts saved before a simulated reload', async () => {
    await service.saveMeetingMetadata({
      meetingId: 'reload-test-2',
      title: 'Recording with transcripts',
      startTime: Date.now(),
      lastUpdated: Date.now(),
      transcriptCount: 0,
      savedToSQLite: false,
    });

    const segments = [
      { text: 'Hello everyone', timestamp: '2026-04-11T10:00:00Z', confidence: 0.95, sequence_id: 1, audio_start_time: 0, audio_end_time: 2, duration: 2 },
      { text: 'Welcome to the meeting', timestamp: '2026-04-11T10:00:02Z', confidence: 0.93, sequence_id: 2, audio_start_time: 2, audio_end_time: 5, duration: 3 },
      { text: 'Let us begin', timestamp: '2026-04-11T10:00:05Z', confidence: 0.91, sequence_id: 3, audio_start_time: 5, audio_end_time: 7, duration: 2 },
    ];

    for (const seg of segments) {
      await service.saveTranscript('reload-test-2', seg);
    }

    const freshService = new IndexedDBService();
    await freshService.init();

    const recovered = await freshService.getTranscripts('reload-test-2');
    expect(recovered).toHaveLength(3);

    const texts = recovered.map((t: any) => t.text);
    expect(texts).toContain('Hello everyone');
    expect(texts).toContain('Welcome to the meeting');
    expect(texts).toContain('Let us begin');
  });

  it('marks meeting as unsaved in IndexedDB until explicit finalization', async () => {
    await service.saveMeetingMetadata({
      meetingId: 'reload-test-3',
      title: 'Unfinalised meeting',
      startTime: Date.now(),
      lastUpdated: Date.now(),
      transcriptCount: 0,
      savedToSQLite: false,
    });

    const meta = await service.getMeetingMetadata('reload-test-3');
    expect(meta?.savedToSQLite).toBe(false);
  });

  it('preserves transcript ordering across a simulated reload', async () => {
    await service.saveMeetingMetadata({
      meetingId: 'order-test',
      title: 'Ordering Test',
      startTime: Date.now(),
      lastUpdated: Date.now(),
      transcriptCount: 0,
      savedToSQLite: false,
    });

    for (let i = 1; i <= 5; i++) {
      await service.saveTranscript('order-test', {
        text: `Segment ${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        confidence: 0.9,
        sequence_id: i,
        audio_start_time: (i - 1) * 2,
        audio_end_time: i * 2,
        duration: 2,
      });
    }

    const freshService = new IndexedDBService();
    await freshService.init();

    const recovered = await freshService.getTranscripts('order-test');
    expect(recovered).toHaveLength(5);

    for (let i = 0; i < recovered.length; i++) {
      expect(recovered[i].sequenceId).toBe(i + 1);
    }
  });
});
