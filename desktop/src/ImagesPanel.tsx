/**
 * Images mode: pictures for the matrix, however they got here. Three views of
 * one library: the saved ones (yours and the ready-made), the pixel editor,
 * and bringing a picture or GIF in from a file.
 */
import { useState } from 'react';
import { useBridge } from './bridge';
import { deleteImage, editImage, imageLabel, library, showImage, useSaved } from './library';
import { MatrixView } from './MatrixView';
import { DrawPanel, ImagePanel } from './panels';

const VIEWS = [
  { id: 'saved', label: 'Saved' },
  { id: 'draw', label: 'Draw' },
  { id: 'file', label: 'From a file' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export function ImagesPanel(props: { go: (tab: string) => void }) {
  const [view, setView] = useState<View>('saved');
  return (
    <>
      <div className="segmented images-views" role="tablist" aria-label="Images">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      {/* All three stay mounted, so a half-finished drawing survives a look at the saved ones. */}
      <div hidden={view !== 'saved'}>
        <Saved toDraw={() => setView('draw')} toFile={() => setView('file')} />
      </div>
      <div hidden={view !== 'draw'}>
        <DrawPanel {...props} />
      </div>
      <div hidden={view !== 'file'}>
        <ImagePanel {...props} />
      </div>
    </>
  );
}

/** The library: click a picture to put it on the matrix. Yours can be edited and deleted. */
function Saved({ toDraw, toFile }: { toDraw: () => void; toFile: () => void }) {
  const saved = useSaved();
  const playing = useBridge().playing;
  const items = library();
  const yours = items.filter((i) => !i.builtin);
  const tile = (item: (typeof items)[number]) => {
    const on = playing === imageLabel(item.name);
    return (
      <div key={item.id} className={on ? 'thumb on' : 'thumb'}>
        <button className="thumb-open" onClick={() => showImage(item)} title={`Show ${item.name} on the matrix`}>
          <MatrixView frame={item.frames[0]!} size={84} label={item.name} />
          <span>{item.frames.length > 1 ? `${item.name} · ${item.frames.length} frames` : item.name}</span>
        </button>
        {!item.builtin && (
          <span className="thumb-links">
            <button
              className="link"
              onClick={() => {
                const image = saved.find((d) => d.name === item.name);
                if (image) editImage(image);
                toDraw();
              }}
            >
              Edit
            </button>
            <button className="link danger" onClick={() => deleteImage(item.name)}>
              Delete
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <section className="card">
        <h2>Yours</h2>
        {yours.length === 0 ? (
          <p className="muted">
            Nothing saved yet.{' '}
            <button className="inline" onClick={toDraw}>
              Draw one
            </button>{' '}
            or{' '}
            <button className="inline" onClick={toFile}>
              bring one in from a file
            </button>
            , then give it a name.
          </p>
        ) : (
          <div className="gallery">{yours.map(tile)}</div>
        )}
      </section>
      <section className="card">
        <h2>Ready-made</h2>
        <div className="gallery">{items.filter((i) => i.builtin).map(tile)}</div>
        <p className="hint">Click one to put it on the matrix. All of these are also in the island, under Images.</p>
      </section>
    </>
  );
}
