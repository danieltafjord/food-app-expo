/* eslint-disable import/first -- jest.mock must precede the imports it stubs */
let appStateListener: ((state: string) => void) | undefined;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove() {} };
    },
  },
}));
jest.mock('@/lib/haptics', () => ({ hapticWarning: () => {}, hapticSuccess: () => {} }));

import { addWithUndo, commitPendingDelete, deleteWithUndo, undoPendingDelete } from './undo';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  undoPendingDelete();
  jest.useRealTimers();
});

it('commits the delete once the undo window closes', () => {
  const run = jest.fn();
  deleteWithUndo('Deleted', ['a'], run);
  jest.advanceTimersByTime(4999);
  expect(run).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(1);
});

it('never commits an undone delete', () => {
  const run = jest.fn();
  deleteWithUndo('Deleted', ['a'], run);
  undoPendingDelete();
  jest.advanceTimersByTime(10_000);
  expect(run).not.toHaveBeenCalled();
});

it('commits the previous delete when another one starts', () => {
  const first = jest.fn();
  const second = jest.fn();
  deleteWithUndo('First', ['a'], first);
  deleteWithUndo('Second', ['b'], second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  jest.advanceTimersByTime(5000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it('commits when the app leaves the foreground', () => {
  const run = jest.fn();
  deleteWithUndo('Deleted', ['a'], run);
  appStateListener?.('background');
  expect(run).toHaveBeenCalledTimes(1);
  commitPendingDelete();
  expect(run).toHaveBeenCalledTimes(1);
});

it('takes back an addition only when Undo is pressed within the window', () => {
  const undo = jest.fn();
  addWithUndo('Added', undo);
  jest.advanceTimersByTime(5000);
  undoPendingDelete();
  expect(undo).not.toHaveBeenCalled();

  addWithUndo('Added', undo);
  undoPendingDelete();
  expect(undo).toHaveBeenCalledTimes(1);

  // A delete starting afterwards keeps the addition.
  addWithUndo('Added', undo);
  deleteWithUndo('Deleted', ['a'], jest.fn());
  undoPendingDelete();
  expect(undo).toHaveBeenCalledTimes(1);
});
