import type { Plugin } from 'vite';

export interface ObservationRequest { method?: string; url?: string }
export interface ObservationResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}
export type ObservationNext = () => void;

export declare function observationBoundary(req: ObservationRequest, res: ObservationResponse, next: ObservationNext): void;
export declare function observationBoundaryPlugin(): Plugin;
