export type DownloadingStatusPayload = number | { progress: number };

export type DownloadingStatus = { Downloading: DownloadingStatusPayload };
export type ErrorStatus = { Error: string };
export type CorruptedStatus = {
  Corrupted: {
    file_size: number;
    expected_min_size: number;
  };
};

export type DownloadableModelStatus =
  | 'Available'
  | 'Missing'
  | DownloadingStatus
  | ErrorStatus
  | CorruptedStatus;

type ModelStatusObject = Exclude<DownloadableModelStatus, 'Available' | 'Missing'>;

function isStatusObject(
  status: DownloadableModelStatus
): status is ModelStatusObject {
  return typeof status === 'object' && status !== null;
}

export function isAvailableStatus(
  status: DownloadableModelStatus
): status is 'Available' {
  return status === 'Available';
}

export function isMissingStatus(
  status: DownloadableModelStatus
): status is 'Missing' {
  return status === 'Missing';
}

export function isDownloadingStatus(
  status: DownloadableModelStatus
): status is DownloadingStatus {
  return isStatusObject(status) && 'Downloading' in status;
}

export function isErrorStatus(
  status: DownloadableModelStatus
): status is ErrorStatus {
  return isStatusObject(status) && 'Error' in status;
}

export function isCorruptedStatus(
  status: DownloadableModelStatus
): status is CorruptedStatus {
  return isStatusObject(status) && 'Corrupted' in status;
}

export function createDownloadingStatus(progress: number): DownloadingStatus {
  return { Downloading: progress };
}

export function getDownloadProgress(
  status: DownloadableModelStatus
): number | null {
  if (!isDownloadingStatus(status)) {
    return null;
  }

  const payload = status.Downloading;
  if (typeof payload === 'number') {
    return payload;
  }

  if (typeof payload === 'object' && payload !== null && 'progress' in payload) {
    const progressValue = payload.progress;
    if (typeof progressValue === 'number') {
      return progressValue;
    }
  }

  return null;
}
