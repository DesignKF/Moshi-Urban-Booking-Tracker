import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {PwaControls} from './PwaControls';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaControls />
  </StrictMode>,
);
