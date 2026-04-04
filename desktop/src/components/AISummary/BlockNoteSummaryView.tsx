"use client";

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import "@blocknote/shadcn/style.css";
import {
  createBlocknoteSummaryPayload,
  type BlockNoteBlock,
  type SummaryPayload,
} from '@/contracts/summaryContract';

// Dynamically import BlockNote Editor to avoid SSR issues
const Editor = dynamic(() => import('../BlockNoteEditor/Editor'), { ssr: false });

interface BlockNoteSummaryViewProps {
  summaryData: SummaryPayload | null;
  onSave?: (data: SummaryPayload) => void;
  status?: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  error?: string | null;
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface BlockNoteSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  isDirty: boolean;
}

export const BlockNoteSummaryView = forwardRef<BlockNoteSummaryViewRef, BlockNoteSummaryViewProps>(({
  summaryData,
  onSave,
  onDirtyChange
}, ref) => {
  const [isDirty, setIsDirty] = useState(false);
  const [currentBlocks, setCurrentBlocks] = useState<Block[]>([]);
  const isContentLoaded = useRef(false);

  // Create BlockNote editor for markdown parsing
  const editor = useCreateBlockNote({
    initialContent: undefined
  });

  const format = summaryData?.format;

  // Parse markdown to blocks when format is markdown
  useEffect(() => {
    if (!summaryData || format !== 'markdown' || !editor) {
      return;
    }

    isContentLoaded.current = false;
    setIsDirty(false);

    const loadMarkdown = async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(summaryData.markdown);
        editor.replaceBlocks(editor.document, blocks);
        setCurrentBlocks(blocks as unknown as Block[]);

        // Delay to ensure editor has finished rendering before allowing onChange
        setTimeout(() => {
          isContentLoaded.current = true;
        }, 100);
      } catch (err) {
        console.error('Failed to parse markdown:', err);
      }
    };

    void loadMarkdown();
  }, [format, summaryData, editor]);

  // Set content loaded flag for blocknote format
  useEffect(() => {
    if (!summaryData || format !== 'blocknote') {
      return;
    }

    isContentLoaded.current = false;
    setIsDirty(false);
    setCurrentBlocks(summaryData.summary_json as unknown as Block[]);

    // Delay to ensure editor has finished rendering
    setTimeout(() => {
      isContentLoaded.current = true;
    }, 100);
  }, [format, summaryData]);

  const handleEditorChange = useCallback((blocks: Block[]) => {
    // Only set dirty flag if content has finished loading
    if (!isContentLoaded.current) {
      return;
    }

    setCurrentBlocks(blocks);
    setIsDirty(true);
  }, []);

  // Notify parent of dirty state changes
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!summaryData || !onSave || !isDirty) {
      return;
    }

    try {
      const blocksToSave = currentBlocks.length > 0
        ? currentBlocks
        : (summaryData.format === 'blocknote'
          ? (summaryData.summary_json as unknown as Block[])
          : editor.document);

      const markdown = await editor.blocksToMarkdownLossy(blocksToSave);

      onSave(
        createBlocknoteSummaryPayload(
          markdown,
          blocksToSave as unknown as BlockNoteBlock[],
        ),
      );

      setIsDirty(false);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save changes. Please try again.');
    }
  }, [summaryData, onSave, isDirty, currentBlocks, editor]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    saveSummary: handleSave,
    getMarkdown: async () => {
      try {
        if (!summaryData) {
          return '';
        }

        if (summaryData.format === 'markdown') {
          return await editor.blocksToMarkdownLossy(editor.document);
        }

        if (currentBlocks.length > 0) {
          return await editor.blocksToMarkdownLossy(currentBlocks);
        }

        return summaryData.markdown;
      } catch (err) {
        console.error('Failed to generate markdown:', err);
        return '';
      }
    },
    isDirty
  }), [handleSave, isDirty, editor, summaryData, currentBlocks]);

  if (!summaryData) {
    return null;
  }

  // Render BlockNote format (has summary_json)
  if (summaryData.format === 'blocknote') {
    return (
      <div className="flex flex-col w-full">
        <div className="w-full">
          <Editor
            initialContent={summaryData.summary_json as unknown as Block[]}
            onChange={handleEditorChange}
            editable={true}
          />
        </div>
      </div>
    );
  }

  // Render Markdown format (parse and display in BlockNote)
  return (
    <div className="flex flex-col w-full">
      <div className="w-full">
        <BlockNoteView
          editor={editor}
          editable={true}
          onChange={() => {
            if (isContentLoaded.current) {
              handleEditorChange(editor.document as unknown as Block[]);
            }
          }}
          theme="light"
        />
      </div>
    </div>
  );
});

BlockNoteSummaryView.displayName = 'BlockNoteSummaryView';
