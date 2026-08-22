import type { Meta, StoryObj } from '@storybook/react-vite';
import { Readout } from '../atoms/Readout';
import { FigureRow } from './FigureRow';

// A LINE OF FIGURES. Five surfaces wrote their own and agreed on everything except a gap nobody chose:
// 8/8px, 3.2/14.4px and 8/8px. `baseline` and not `center`, because the parts are text at two sizes.
const meta = { title: 'Molecules/FigureRow', component: FigureRow } satisfies Meta<typeof FigureRow>;
export default meta;

export const Playground: StoryObj<typeof meta> = {
  render: () => (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '32rem' }}>
      <FigureRow>
        <span>
          duration <Readout>1 234 ms</Readout>
        </span>
        <span>
          cost <Readout>$0.0142</Readout>
        </span>
        <span>
          tokens <Readout>18 902</Readout>
        </span>
      </FigureRow>
      {/* THE WRAP IS THE OPEN FINDING, and drawing it is the point: a wrapped row is a column of figures
          that does not align, which is the one thing the treatment exists to give. Two of the eleven rows
          the browser harness measures are still wrapped, and they are the organism phase's. */}
      <div style={{ width: '14rem' }}>
        <FigureRow>
          <span>
            duration <Readout>1 234 ms</Readout>
          </span>
          <span>
            cost <Readout>$0.0142</Readout>
          </span>
          <span>
            tokens <Readout>18 902</Readout>
          </span>
        </FigureRow>
      </div>
    </div>
  ),
};
