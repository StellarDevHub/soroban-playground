import axios from 'axios';

/**
 * Audit Logger Middleware
 * 
 * Intercepts state-changing requests and logs them to the Indexer's audit trail.
 */
const auditLogger = async (req, res, next) => {
    // Only log state-changing methods
    const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (!stateChangingMethods.includes(req.method)) {
        return next();
    }

    // Capture the original end function to log after the request completes
    const originalEnd = res.end;
    
    res.end = function (chunk, encoding) {
        res.end = originalEnd;
        res.end(chunk, encoding);

        // Only log successful operations
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const auditData = {
                event_type: `${req.method}_${req.path.replace(/\//g, '_').toUpperCase()}`,
                actor: req.headers['x-user-id'] || req.ip || 'anonymous',
                payload: JSON.stringify({
                    path: req.path,
                    method: req.method,
                    params: req.params,
                    query: req.query,
                    body: req.body,
                    status: res.statusCode
                })
            };

            // Fire and forget to indexer
            const indexerUrl = process.env.INDEXER_URL || 'http://localhost:3001';
            axios.post(`${indexerUrl}/api/audit/log`, auditData)
                .catch(err => console.error('Failed to send audit log to indexer:', err.message));
        }
    };

    next();
};

export default auditLogger;

