import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SETTINGS_SELECT_TRIGGER_CLASS,
} from '@/components/settingsShared';
import { useConfig } from '@/contexts/ConfigContext';
import Analytics from '@/lib/analytics';

export interface Language {
  code: string;
  name: string;
}

const LANGUAGES: Language[] = [
  { code: 'auto', name: 'Auto detect' },
  { code: 'auto-translate', name: 'Auto detect and translate to English' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'ru', name: 'Russian' },
  { code: 'ko', name: 'Korean' },
  { code: 'fr', name: 'French' },
  { code: 'ja', name: 'Japanese' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'ca', name: 'Catalan' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ar', name: 'Arabic' },
  { code: 'sv', name: 'Swedish' },
  { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fi', name: 'Finnish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'he', name: 'Hebrew' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'el', name: 'Greek' },
  { code: 'ms', name: 'Malay' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'da', name: 'Danish' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ta', name: 'Tamil' },
  { code: 'no', name: 'Norwegian' },
  { code: 'th', name: 'Thai' },
  { code: 'ur', name: 'Urdu' },
  { code: 'hr', name: 'Croatian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'la', name: 'Latin' },
  { code: 'mi', name: 'Maori' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'cy', name: 'Welsh' },
  { code: 'sk', name: 'Slovak' },
  { code: 'te', name: 'Telugu' },
  { code: 'fa', name: 'Persian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'sr', name: 'Serbian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'kn', name: 'Kannada' },
  { code: 'et', name: 'Estonian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'br', name: 'Breton' },
  { code: 'eu', name: 'Basque' },
  { code: 'is', name: 'Icelandic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sw', name: 'Swahili' },
  { code: 'gl', name: 'Galician' },
  { code: 'mr', name: 'Marathi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'si', name: 'Sinhala' },
  { code: 'km', name: 'Khmer' },
  { code: 'sn', name: 'Shona' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'so', name: 'Somali' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'oc', name: 'Occitan' },
  { code: 'ka', name: 'Georgian' },
  { code: 'be', name: 'Belarusian' },
  { code: 'tg', name: 'Tajik' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'am', name: 'Amharic' },
  { code: 'yi', name: 'Yiddish' },
  { code: 'lo', name: 'Lao' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'fo', name: 'Faroese' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'ps', name: 'Pashto' },
  { code: 'tk', name: 'Turkmen' },
  { code: 'nn', name: 'Norwegian Nynorsk' },
  { code: 'mt', name: 'Maltese' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'my', name: 'Myanmar' },
  { code: 'bo', name: 'Tibetan' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'as', name: 'Assamese' },
  { code: 'tt', name: 'Tatar' },
  { code: 'haw', name: 'Hawaiian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ba', name: 'Bashkir' },
  { code: 'jw', name: 'Javanese' },
  { code: 'su', name: 'Sundanese' },
];

interface LanguageSelectionProps {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  provider?: 'localWhisper' | 'parakeet';
  variant?: 'default' | 'minimal';
}

function getLanguageStatusMessage(
  selectedLanguage: string,
  provider: 'localWhisper' | 'parakeet'
) {
  if (provider === 'parakeet' && selectedLanguage === 'auto-translate') {
    return {
      tone: 'info' as const,
      message: 'Parakeet will auto-detect speech and return English output.',
    };
  }

  if (provider === 'parakeet') {
    return {
      tone: 'warning' as const,
      message: 'Parakeet uses automatic language detection only.',
    };
  }

  if (selectedLanguage === 'auto-translate') {
    return {
      tone: 'info' as const,
      message: 'Output will be translated to English.',
    };
  }

  if (selectedLanguage === 'auto') {
    return {
      tone: 'neutral' as const,
      message: 'MeetFree will detect the spoken language automatically.',
    };
  }

  const languageName =
    LANGUAGES.find((language) => language.code === selectedLanguage)?.name ??
    selectedLanguage;

  return {
    tone: 'neutral' as const,
    message: `Transcription is optimized for ${languageName}.`,
  };
}

export function LanguageSelection({
  selectedLanguage,
  onLanguageChange,
  disabled = false,
  provider = 'localWhisper',
  variant = 'default',
}: LanguageSelectionProps) {
  const [saving, setSaving] = useState(false);
  const { setSelectedLanguage } = useConfig();

  const availableLanguages = useMemo(
    () =>
      provider === 'parakeet'
        ? LANGUAGES.filter(
            (language) =>
              language.code === 'auto' || language.code === 'auto-translate'
          )
        : LANGUAGES,
    [provider]
  );

  const status = useMemo(
    () => getLanguageStatusMessage(selectedLanguage, provider),
    [provider, selectedLanguage]
  );

  const handleLanguageChange = async (languageCode: string) => {
    setSaving(true);

    try {
      setSelectedLanguage(languageCode);
      onLanguageChange(languageCode);

      const selected = LANGUAGES.find((language) => language.code === languageCode);
      await Analytics.track('language_selected', {
        language_code: languageCode,
        language_name: selected?.name || 'Unknown',
        is_auto_detect: (languageCode === 'auto').toString(),
        is_auto_translate: (languageCode === 'auto-translate').toString(),
      });

      toast.success('Language updated');
    } catch (error) {
      console.error('Failed to save language preference:', error);
      toast.error('Failed to save language preference', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const noteClasses =
    status.tone === 'warning'
      ? 'text-amber-700'
      : status.tone === 'info'
        ? 'text-slate-500'
        : 'text-slate-500';

  if (variant === 'minimal') {
    return (
      <div className="space-y-2.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1">
            <label className="text-[13px] font-medium leading-5 text-slate-950">
              Language
            </label>
            <div className={`mt-1 text-[11px] leading-5 ${noteClasses}`}>
              {status.message}
            </div>
          </div>

          <div className="w-full shrink-0 sm:w-[240px]">
            <Select
              value={selectedLanguage}
              onValueChange={(value) => {
                void handleLanguageChange(value);
              }}
              disabled={disabled || saving}
            >
              <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Choose a language" />
              </SelectTrigger>
              <SelectContent>
                {availableLanguages.map((language) => (
                  <SelectItem key={language.code} value={language.code}>
                    {language.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-slate-500" />
        <h4 className="text-sm font-medium text-slate-950">Language</h4>
      </div>

      <Select
        value={selectedLanguage}
        onValueChange={(value) => {
          void handleLanguageChange(value);
        }}
        disabled={disabled || saving}
      >
        <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
          <SelectValue placeholder="Choose a language" />
        </SelectTrigger>
        <SelectContent>
          {availableLanguages.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className={`text-[11px] leading-5 ${noteClasses}`}>
        {status.message}
      </div>
    </div>
  );
}



