'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import {
  FilesAndStorageSettings,
  NotificationsSettings,
  RecordingSettings,
  TranscriptionSettings,
} from '@/components/settings';
import { useConfig } from '@/contexts/ConfigContext';

type SectionId =
  | 'recording'
  | 'transcription'
  | 'summaries'
  | 'files'
  | 'notifications';

type SectionConfig = {
  id: SectionId;
  label: string;
  content: JSX.Element;
};

export default function SettingsPage() {
  const { loadPreferences } = useConfig();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    recording: null,
    transcription: null,
    summaries: null,
    files: null,
    notifications: null,
  });
  const [activeSection, setActiveSection] = useState<SectionId>('recording');

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const sections = useMemo<SectionConfig[]>(() => {
    return [
      {
        id: 'recording',
        label: 'Recording',
        content: <RecordingSettings />,
      },
      {
        id: 'transcription',
        label: 'Transcription',
        content: <TranscriptionSettings mode="full" />,
      },
      {
        id: 'summaries',
        label: 'Summaries',
        content: <SummaryModelSettings mode="full" />,
      },
      {
        id: 'files',
        label: 'Files Location',
        content: <FilesAndStorageSettings />,
      },
      {
        id: 'notifications',
        label: 'Notifications',
        content: <NotificationsSettings />,
      },
    ];
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]) {
          setActiveSection(visible[0].target.id as SectionId);
        }
      },
      {
        root,
        threshold: [0.15, 0.35, 0.6],
        rootMargin: '-10% 0px -55% 0px',
      }
    );

    sections.forEach((section) => {
      const node = sectionRefs.current[section.id];
      if (node) {
        observer.observe(node);
      }
    });

    return () => observer.disconnect();
  }, [sections]);

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <div className="h-full overflow-hidden bg-slate-50">
      <div ref={containerRef} className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:gap-12">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <nav className="hidden lg:block">
                <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  {sections.map((section) => {
                    const isActive = activeSection === section.id;

                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={[
                          'block w-full rounded-md px-3 py-2 text-left text-[12px] font-medium transition-all duration-150',
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                        ].join(' ')}
                      >
                        {section.label}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </aside>

            <main className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 lg:hidden">
                {sections.map((section) => {
                  const isActive = activeSection === section.id;

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={[
                        'relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors duration-150',
                        isActive
                          ? 'text-slate-900'
                          : 'text-slate-600 hover:text-slate-900',
                      ].join(' ')}
                    >
                      {section.label}
                      {isActive && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-10">
                {sections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    ref={(node) => {
                      sectionRefs.current[section.id] = node;
                    }}
                    className="scroll-mt-6"
                  >
                    {section.id !== 'recording' ? (
                      <div className="mb-8 h-px bg-slate-200" />
                    ) : null}
                    {section.content}
                  </section>
                ))}
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

