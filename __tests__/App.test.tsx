/**
 * Step 1 smoke test: the RN jest preset + TS + render pipeline works.
 *
 * NOTE (RN 0.88 / React 19.3): the initial commit is scheduled asynchronously
 * by the web-based scheduler, so we await one macrotask tick after `act`
 * before reading the tree. Reuse this pattern in Steps 10–13 UI tests.
 * @format
 */
import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

test('renders the Gate 1A scaffold screen', async () => {
  const component = await act(async () => ReactTestRenderer.create(<App />));
  await tick(); // let the RN 0.88 scheduler commit the root
  const tree = JSON.stringify(component.toJSON());
  expect(tree).toContain('Nafas Vitality');
  expect(tree).toContain('Passive Metabolic Radar');
});
