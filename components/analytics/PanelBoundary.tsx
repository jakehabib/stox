'use client';

import React, { Suspense } from 'react';

/**
 * One panel's blast radius.
 *
 * This screen does a great deal of array arithmetic over data that can legally
 * be empty — a club with no draft picks, a league in week one with no games, a
 * roster short at a position. Every panel is written to be total over those
 * inputs, and this is the backstop for the case where one is not: a panel that
 * throws renders its own "could not be computed" box and the other nine render
 * normally, instead of the whole department going down to the route-level
 * error boundary.
 *
 * It is a class component because that is the only thing React lets catch a
 * render error, and it is a client component for the same reason. The panels
 * inside it are still server components — they are passed through as children.
 */
interface Props {
  /** Columns of the twelve-wide grid, so a failed panel keeps the layout. */
  span: 5 | 6 | 7 | 12;
  title: string;
  children: React.ReactNode;
}

export class PanelBoundary extends React.Component<Props, { failed: boolean }> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Logged rather than shown: the message is for whoever is reading the
    // server output, and a stack trace on a stats screen helps nobody.
    console.error(`[analytics] panel "${this.props.title}" failed to render`, error);
  }

  render() {
    // The Suspense wrapper is load-bearing, not decoration. Without it a Server
    // Component that throws takes the whole RSC payload with it and the page
    // falls through to the route-level error boundary — measured, not assumed:
    // the same panel throwing returns 500 with no Suspense and 200 with it,
    // with the other ten panels rendering normally. Suspense gives React a
    // point at which it can serialise the error into the flight stream instead
    // of aborting it, and this class then catches it on the client.
    if (!this.state.failed) return <Suspense>{this.props.children}</Suspense>;
    const SPAN: Record<number, string> = {
      5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 12: 'lg:col-span-12',
    };
    return (
      <section className={`card card-pad col-span-12 ${SPAN[this.props.span]} min-w-0`}>
        <div className="section-head items-end">
          <div className="min-w-0">
            <div className="label-sm text-[10px] tracking-[0.1em]">Not computed</div>
            <h2 className="section-title text-[15px] mt-0.5">{this.props.title}</h2>
          </div>
        </div>
        <p className="text-xs text-muted leading-relaxed mt-2.5">
          This panel could not be computed from what this save currently holds, so it is showing nothing rather
          than showing something wrong. Every other panel on the page is unaffected.
        </p>
      </section>
    );
  }
}
