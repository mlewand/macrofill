import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/en.json';
import { NOTICE_MS, SaveNotice, type Notice } from '../src/SaveNotice';

afterEach(() => {
  vi.useRealTimers();
});

const notice = (id: number, result: Notice['result']): Notice => ({ id, result });

function setup(initial?: Notice) {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  const view = render(<SaveNotice notice={initial} onDismiss={onDismiss} />);
  const show = (next?: Notice) => view.rerender(<SaveNotice notice={next} onDismiss={onDismiss} />);
  return { onDismiss, show, view };
}

/** The polite live region, which is on the page whether there's a notice or not. */
const region = (view: { container: HTMLElement }) =>
  view.container.querySelector<HTMLElement>('[aria-live="polite"]')!;

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('SaveNotice', () => {
  it('#88-2: a synced meal says it was saved, and the notice hides itself after a few seconds', () => {
    const { onDismiss, view } = setup(notice(1, 'synced'));
    expect(region(view)).toHaveTextContent(en.saved.title);
    expect(screen.queryByText(en.saved.pending)).toBeNull();
    tick(NOTICE_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    tick(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('#88-2: a meal kept for later says so, and hides itself too', () => {
    const { onDismiss, view } = setup(notice(1, 'pending'));
    expect(region(view)).toHaveTextContent(en.saved.title);
    expect(region(view)).toHaveTextContent(en.saved.pending);
    tick(NOTICE_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('#88-3: a refused meal is announced as an alert, says where it is, and never hides itself', () => {
    const { onDismiss, view } = setup(notice(1, 'refused'));
    expect(screen.getByRole('alert')).toHaveTextContent(en.saved.refusedTitle);
    expect(screen.getByRole('alert')).toHaveTextContent(en.saved.refused);
    expect(region(view)).toBeEmptyDOMElement();
    tick(60 * 60 * 1000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('#88-4: Dismiss closes the notice by hand, a refused one included', () => {
    const { onDismiss } = setup(notice(1, 'refused'));
    fireEvent.click(screen.getByRole('button', { name: en.notice.dismiss }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('#88-4: a second save replaces the first and starts the countdown again', () => {
    const { onDismiss, show, view } = setup(notice(1, 'synced'));
    tick(NOTICE_MS - 1000);
    show(notice(2, 'pending'));
    expect(region(view)).toHaveTextContent(en.saved.pending);
    tick(NOTICE_MS - 1000);
    expect(onDismiss).not.toHaveBeenCalled();
    tick(1000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('#88-6: the live region is on the page before any text goes into it', () => {
    const { show, view } = setup();
    const status = region(view);
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: en.notice.dismiss })).toBeNull();
    show(notice(1, 'synced'));
    // The same element, now with text: that is what screen readers announce.
    expect(region(view)).toBe(status);
    expect(status).toHaveTextContent(en.saved.title);
  });

  it('#88-6: the countdown stops when the notice is replaced by none, or the screen goes away', () => {
    const { onDismiss, show, view } = setup(notice(1, 'synced'));
    show(undefined);
    tick(NOTICE_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();
    show(notice(2, 'synced'));
    view.unmount();
    tick(NOTICE_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
