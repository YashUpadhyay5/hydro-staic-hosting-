import React, { useState } from 'react';
import { api } from '../services/api';

export default function Login({ onLoginSuccess }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const inputUser = (email || '').trim().toLowerCase();
        // Hardcoded user: name yash, password 12345678
        if ((inputUser === 'yash' || inputUser === 'yash@hrms.com' || inputUser === 'yash@admin.com') && password === '12345678') {
            const hardcodedUser = {
                id: 'hardcoded_yash_id',
                _id: 'hardcoded_yash_id',
                name: 'Yash',
                email: 'yash@hrms.com',
                role: 'ADMIN',
                status: 'ACTIVE'
            };
            const hardcodedToken = 'hardcoded-token-yash-12345678';
            localStorage.setItem('adminUser', JSON.stringify(hardcodedUser));
            localStorage.setItem('adminToken', hardcodedToken);
            localStorage.setItem('token', hardcodedToken);
            localStorage.setItem('username', 'Yash');
            onLoginSuccess(hardcodedUser, hardcodedToken);
            setLoading(false);
            return;
        }

        try {
            const res = await api.login(email, password);
            const userRole = String(res.user?.role || '').toUpperCase();
            if (res.user && userRole !== 'EMPLOYEE') {
                localStorage.setItem('adminUser', JSON.stringify(res.user));
                localStorage.setItem('adminToken', res.token);
                onLoginSuccess(res.user, res.token);
            } else {
                throw new Error("Access Denied: Web Dashboard access is restricted to authorized roles.");
            }
        } catch (err) {
            setError(err.message || 'Invalid credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div id="login-screen" className="screen">
            <div className="login-container glass">
                <div className="login-header">
                    <i className="fa-solid fa-shield-halved"></i>
                    <h2>Admin Portal</h2>
                    <p>Sign in to manage HRMS operations</p>
                </div>
                <form id="login-form" onSubmit={handleSubmit} autoComplete="off">
                    <div className="input-group">
                        <i className="fa-solid fa-user"></i>
                        <input 
                            type="text" 
                            placeholder="Email or Username" 
                            required
                            autoComplete="username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <i className="fa-solid fa-lock"></i>
                        <input 
                            type="password" 
                            placeholder="Password" 
                            required
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" id="login-btn" disabled={loading}>
                        {loading ? (
                            <i className="fa-solid fa-spinner fa-spin"></i>
                        ) : (
                            <>
                                <span>Sign In</span>
                                <i className="fa-solid fa-arrow-right"></i>
                            </>
                        )}
                    </button>
                    {error && <div id="login-error" className="error-text">{error}</div>}
                </form>
            </div>
        </div>
    );
}
