import { useMutation } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, Sparkles } from 'lucide-react';
import * as React from 'react';

import { DataFreshnessIndicator } from '@/components/common/data-freshness';
import { AtlasMark } from '@/components/common/logo';
import { PageHeader } from '@/components/common/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataFreshness, useHasConnections } from '@/features/accounts/hooks';
import { EdgeFunctionError } from '@/features/connections/api';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { useRefreshConnections } from '@/features/connections/hooks';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { cn } from '@/lib/utils';

import { sendChatMessage } from './api';
import { ChatBlockRenderer } from './chat-blocks';
import { type ChatMessage, SUGGESTED_QUESTIONS } from './types';

/**
 * Atlas AI.
 *
 * The conversation is client-side state, sent in full with each turn. It is
 * deliberately not persisted: financial questions are transient, and storing
 * them would create a second copy of sensitive information for no benefit.
 *
 * Data freshness is shown at all times, because the assistant answers from a
 * database that syncs on a delay and must never imply otherwise.
 */
export function ChatPage() {
  const connections = useHasConnections();
  const freshness = useDataFreshness();
  const refresh = useRefreshConnections();

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);

  const transcriptEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const chat = useMutation({
    mutationFn: sendChatMessage,
    onSuccess: (response) => {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks: response.blocks,
          toolsUsed: response.toolsUsed,
          dataAsOf: response.dataAsOf,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof EdgeFunctionError
          ? { code: mutationError.code, message: mutationError.message }
          : { code: 'CHAT_ERROR', message: 'Atlas AI could not answer that. Please try again.' },
      );
    },
  });

  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, chat.isPending]);

  const send = (question: string) => {
    const trimmed = question.trim();
    if (trimmed.length === 0 || chat.isPending) return;

    setError(null);
    setInput('');

    const next: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, next]);

    // The full transcript goes with every turn: the Edge Function is stateless,
    // which keeps conversation history out of the database entirely.
    chat.mutate([
      ...messages.map((message) => ({
        role: message.role,
        content: message.text ?? blocksToPlainText(message),
      })),
      { role: 'user' as const, content: trimmed },
    ]);
  };

  if (connections.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Atlas AI" description="Ask questions about your finances" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!connections.hasAnyAccount) {
    return (
      <div className="space-y-6">
        <PageHeader title="Atlas AI" description="Ask questions about your finances" />
        <Alert variant="info">
          <AlertCircle aria-hidden="true" />
          <div>
            <AlertTitle>Nothing to talk about yet</AlertTitle>
            <AlertDescription>
              Atlas AI answers from your synchronised financial data. Connect an institution first —
              it will not invent figures in the meantime.
            </AlertDescription>
          </div>
        </Alert>
        <OnboardingPanel connectAction={<ConnectInstitutionButton size="lg" />} />
      </div>
    );
  }

  const isUnavailable =
    error?.code === 'CHAT_UNAVAILABLE' || error?.code === 'EDGE_FUNCTION_NOT_DEPLOYED';

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <PageHeader
        title="Atlas AI"
        description="Ask questions about your finances"
        actions={
          <DataFreshnessIndicator
            freshness={freshness.overall}
            onRefresh={() => refresh.mutate(undefined)}
            isRefreshing={refresh.isPending}
          />
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.length === 0 ? (
              <EmptyConversation onAsk={send} />
            ) : (
              <ol className="space-y-6">
                {messages.map((message) => (
                  <li key={message.id}>
                    {message.role === 'user' ? (
                      <UserMessage text={message.text ?? ''} />
                    ) : (
                      <AssistantMessage message={message} />
                    )}
                  </li>
                ))}
              </ol>
            )}

            {chat.isPending ? <ThinkingIndicator /> : null}

            {error && !isUnavailable ? (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}

            <div ref={transcriptEndRef} />
          </div>

          {isUnavailable ? (
            <div className="border-t border-border p-4 sm:p-6">
              <Alert variant="warning">
                <AlertCircle aria-hidden="true" />
                <div>
                  <AlertTitle>Atlas AI isn&apos;t available yet</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </div>
              </Alert>
            </div>
          ) : (
            <div className="border-t border-border p-4 sm:p-6">
              {messages.length > 0 ? (
                <SuggestedQuestions onAsk={send} disabled={chat.isPending} compact />
              ) : null}

              <form
                className="relative"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(input);
                }}
              >
                <label htmlFor="chat-input" className="sr-only">
                  Ask about spending, income, balances, or trends
                </label>
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends; Shift+Enter adds a line, which is what
                    // people expect from a chat composer.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send(input);
                    }
                  }}
                  rows={2}
                  placeholder="Ask about spending, income, balances, or trends…"
                  disabled={chat.isPending}
                  className="w-full resize-none rounded-lg border border-input bg-card py-3 pl-4 pr-14 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute bottom-3 right-3 rounded-full"
                  disabled={input.trim().length === 0 || chat.isPending}
                  aria-label="Send message"
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              </form>

              <p className="mt-2 text-xs text-muted-foreground">
                Atlas AI answers from your synchronised data and can make mistakes. Figures shown in
                cards and charts come directly from your transactions — verify anything important.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-subtle px-4 py-2.5 text-sm text-foreground">
        {text}
      </p>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex gap-3">
      <AtlasMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3">
        {message.blocks?.map((block, index) => (
          <ChatBlockRenderer key={index} block={block} />
        ))}

        {/* Naming the tools used is what lets the user check the answer's
            provenance rather than taking it on trust. */}
        {message.toolsUsed && message.toolsUsed.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Answered using: {[...new Set(message.toolsUsed)].map(humaniseTool).join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="mt-6 flex items-center gap-3" role="status" aria-live="polite">
      <AtlasMark className="size-7 shrink-0" />
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-2 animate-pulse rounded-full bg-muted-foreground/50"
            style={{ animationDelay: `${index * 150}ms` }}
            aria-hidden="true"
          />
        ))}
        <span className="ml-1 text-sm text-muted-foreground">Checking your data…</span>
      </div>
    </div>
  );
}

function EmptyConversation({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 text-center">
      <div className="space-y-2">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary">
          <Sparkles className="size-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight">Ask about your finances</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Atlas AI reads your synchronised accounts and transactions. It uses the same calculations
          as the rest of Cash Atlas, so its answers match what you see on the other screens.
        </p>
      </div>

      <SuggestedQuestions onAsk={onAsk} />
    </div>
  );
}

function SuggestedQuestions({
  onAsk,
  disabled,
  compact,
}: {
  onAsk: (question: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const questions = compact ? SUGGESTED_QUESTIONS.slice(0, 3) : SUGGESTED_QUESTIONS;

  return (
    <ul className={cn('flex flex-wrap gap-2', compact ? 'mb-3' : 'justify-center')}>
      {questions.map((question) => (
        <li key={question}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(question)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {question}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Flattens an assistant turn back to text for the next request.
 *
 * Only prose is sent back. Re-sending figures would give the model a second
 * source for numbers it should re-derive from tools.
 */
function blocksToPlainText(message: ChatMessage): string {
  const text = (message.blocks ?? [])
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n');

  return text.length > 0 ? text : '(structured financial data was shown)';
}

function humaniseTool(toolName: string): string {
  return toolName.replace(/_/g, ' ');
}
