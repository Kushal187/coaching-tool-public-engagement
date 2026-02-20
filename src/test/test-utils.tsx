import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { ReactElement } from 'react';

type WrapperOptions = {
  route?: string;
  path?: string;
};

export function renderWithRouter(
  ui: ReactElement,
  { route = '/', path = '/', ...renderOptions }: WrapperOptions & RenderOptions = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>,
    renderOptions,
  );
}

export { render };
export { default as userEvent } from '@testing-library/user-event';
export { screen, within, waitFor, act } from '@testing-library/react';
