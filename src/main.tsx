import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './config/app';
import { App } from './ui/App';
import './ui/styles/global.css';

document.title = APP_NAME;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
