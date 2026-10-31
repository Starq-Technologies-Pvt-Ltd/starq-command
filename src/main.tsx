import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { pmPort } from './lib/pm-client';
import './index.css';

// Capture a `?pm_port=519x` scratch port before the router normalizes the
// hash on first render; otherwise it is gone before any PM request reads it.
pmPort();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
