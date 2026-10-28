import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    React.useEffect(() => {
        localStorage.removeItem('adminUser');
        localStorage.removeItem('adminToken');
    }, []);

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
            navigate('/');
            setLoading(false);
            return;
        }

        try {
            const loginUrl = (import.meta.env && import.meta.env.VITE_API_URL)
                ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/auth/login`
                : `/api/v1/auth/login`;

            const response = await axios.post(loginUrl, {
                email,
                password
            });
            const { user, token } = response.data;
            if (user && token) {
                localStorage.setItem('adminUser', JSON.stringify(user));
                localStorage.setItem('adminToken', token);
                // Also store session tokens for invoice compatibility
                localStorage.setItem('token', token);
                localStorage.setItem('username', user.name || user.email);
                
                navigate('/');
            } else {
                throw new Error("Invalid response from server.");
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Invalid email or password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page-container">
            <div className="login-card glass">
                <div className="login-header">
                    <div className="logo-icon">🛡️</div>
                    <h2>Enterprise Platform</h2>
                    <p>Sign in to access your modules</p>
                </div>
                <form className="login-form" onSubmit={handleSubmit} autoComplete="off">
                    <div className="input-group">
                        <span className="input-icon">👤</span>
                        <input 
                            type="text" 
                            placeholder="Email Address or Username" 
                            required
                            autoComplete="username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <span className="input-icon">🔒</span>
                        <input 
                            type="password" 
                            placeholder="Password" 
                            required
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="login-submit-btn" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                    {error && <div className="login-error-text">{error}</div>}
                </form>
            </div>
        </div>
    );
}
