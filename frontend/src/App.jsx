import React from 'react';
import AppRoutes from './Routes';
import ErrorBoundary from './ErrorBoundary';

function App() {
    return (
        <ErrorBoundary>
            <AppRoutes />
        </ErrorBoundary>
    );
}

export default App;

