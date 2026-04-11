'use client';

interface ConfidenceIndicatorProps {
  confidence: number | null;
  showIndicator?: boolean;
  displayMode?: 'dot' | 'percentage' | 'bar' | 'full';
  extractionMethod?: string;
  extractionVersion?: string;
  tooltipContext?: string;
}

export const ConfidenceIndicator: React.FC<ConfidenceIndicatorProps> = ({
  confidence,
  showIndicator = true,
  displayMode = 'full',
  extractionMethod,
  extractionVersion,
  tooltipContext = 'extraction',
}) => {
  // Don't render if preference is disabled or confidence is null
  if (!showIndicator || confidence === null) {
    return null;
  }

  // Get color class based on confidence threshold
  const getColorClass = (conf: number): string => {
    if (conf >= 0.8) return 'bg-green-500'; // 80-100%: High confidence
    if (conf >= 0.7) return 'bg-yellow-500'; // 70-79%: Good confidence
    if (conf >= 0.4) return 'bg-orange-500'; // 40-69%: Medium confidence
    return 'bg-red-500'; // Below 40%: Low confidence
  };

  const getTextColorClass = (conf: number): string => {
    if (conf >= 0.8) return 'text-green-700';
    if (conf >= 0.7) return 'text-yellow-700';
    if (conf >= 0.4) return 'text-orange-700';
    return 'text-red-700';
  };

  // Get descriptive label for accessibility
  const getConfidenceLabel = (conf: number): string => {
    if (conf >= 0.8) return 'High confidence';
    if (conf >= 0.7) return 'Good confidence';
    if (conf >= 0.4) return 'Medium confidence';
    return 'Low confidence';
  };

  const getTooltipText = (conf: number): string => {
    const percent = (conf * 100).toFixed(0);
    const label = getConfidenceLabel(conf);
    
    let contextText = '';
    if (tooltipContext === 'speaker') {
      contextText = 'Confidence that this speaker matches the linked identity';
    } else if (tooltipContext === 'action_item') {
      contextText = 'Confidence that this text is an action item';
    } else if (tooltipContext === 'decision') {
      contextText = 'Confidence that this text is a decision';
    } else {
      contextText = 'Confidence in this extraction';
    }

    let tooltip = `${percent}% - ${label}\n${contextText}`;
    
    if (extractionMethod || extractionVersion) {
      tooltip += '\n\n';
      if (extractionMethod) tooltip += `Method: ${extractionMethod}`;
      if (extractionMethod && extractionVersion) tooltip += '\n';
      if (extractionVersion) tooltip += `Version: ${extractionVersion}`;
    }
    
    return tooltip;
  };

  const confidencePercent = (confidence * 100).toFixed(0);
  const colorClass = getColorClass(confidence);
  const textColorClass = getTextColorClass(confidence);
  const label = getConfidenceLabel(confidence);
  const tooltipText = getTooltipText(confidence);

  if (displayMode === 'dot') {
    return (
      <div
        className="flex items-center gap-1"
        title={tooltipText}
        aria-label={`Confidence: ${confidencePercent}% - ${label}`}
      >
        <div
          className={`w-2 h-2 rounded-full ${colorClass} transition-colors duration-200`}
          role="status"
        />
      </div>
    );
  }

  if (displayMode === 'percentage') {
    return (
      <span
        className={`text-xs font-medium ${textColorClass}`}
        title={tooltipText}
        aria-label={`Confidence: ${confidencePercent}% - ${label}`}
        role="status"
      >
        {confidencePercent}%
      </span>
    );
  }

  if (displayMode === 'bar') {
    return (
      <div
        className="flex items-center gap-1.5"
        title={tooltipText}
        aria-label={`Confidence: ${confidencePercent}% - ${label}`}
      >
        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${colorClass} transition-all duration-200`}
            style={{ width: `${confidencePercent}%` }}
            role="progressbar"
            aria-valuenow={confidence * 100}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className={`text-xs font-medium ${textColorClass}`}>
          {confidencePercent}%
        </span>
      </div>
    );
  }

  // displayMode === 'full'
  return (
    <div
      className="flex items-center gap-1.5"
      title={tooltipText}
      aria-label={`Confidence: ${confidencePercent}% - ${label}`}
    >
      <div
        className={`w-2 h-2 rounded-full ${colorClass} transition-colors duration-200`}
        role="status"
      />
      <span className={`text-xs font-medium ${textColorClass}`}>
        {confidencePercent}%
      </span>
    </div>
  );
};
