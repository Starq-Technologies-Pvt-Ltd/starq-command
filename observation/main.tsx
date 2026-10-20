import React from 'react';
import ReactDOM from 'react-dom/client';
import { ObservationApp } from './ObservationApp';
import './observation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ObservationApp />
  </React.StrictMode>,
);
