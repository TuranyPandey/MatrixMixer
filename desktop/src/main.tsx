import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './activities';
import { startIslandHost } from './islandHost';
import './styles.css';

startIslandHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
