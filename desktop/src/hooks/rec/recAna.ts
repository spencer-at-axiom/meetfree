import Analytics from '@/lib/analytics';
import type { RecordingStoppedPayload } from '@/services/recordingService';
import { getWc, getWpm } from './recUts';

export async function trkEnd(
  meetId: string,
  pay: RecordingStoppedPayload,
  rows: Array<{ text: string }>
): Promise<void> {
  const durSec = pay.duration_seconds || 0;
  const segCnt = pay.transcript_count ?? rows.length;
  const wordCnt = getWc(rows);
  const wordsPm = getWpm(wordCnt, durSec);
  const meetsDay = await Analytics.getMeetingsCountToday();

  await Analytics.trackMeetingCompleted(meetId, {
    duration_seconds: durSec,
    transcript_segments: segCnt,
    transcript_word_count: wordCnt,
    words_per_minute: wordsPm,
    meetings_today: meetsDay,
  });

  await Analytics.updateMeetingCount();
  await trkAct(durSec);
}

async function trkAct(durSec: number): Promise<void> {
  const { Store } = await import('@tauri-apps/plugin-store');
  const store = await Store.load('analytics.json');
  const total = await store.get<number>('total_meetings');

  if (total !== 1) {
    return;
  }

  const days = await Analytics.calculateDaysSince('first_launch_date');
  await Analytics.track('user_activated', {
    meetings_count: '1',
    days_since_install: days?.toString() || 'null',
    first_meeting_duration_seconds: durSec.toString(),
  });
}
