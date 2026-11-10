export type AccessMode = 'hosted-admin' | 'demo-visitor' | 'local-admin' | null;

// Presentation policy only; protected APIs independently verify identity.
export function capabilities(mode: AccessMode, hostedDeployment: boolean) {
    return {
        canViewDashboard: hostedDeployment
            ? mode === 'hosted-admin' || mode === 'demo-visitor'
            : mode === 'local-admin',
        canOperateTerminal: !hostedDeployment && mode === 'local-admin',
        sampleDataOnly: hostedDeployment,
    };
}
