module.exports = {
    tenantName: "yourtenantname.onmicrosoft.com",
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    policySignUpSignIn: "B2C_1A_SIGNUP_SIGNIN",
    policyEditProfile: "B2C_1A_PROFILEEDIT",
    policyResetPassword: "B2C_1A_PASSWORDRESET",
    redirectUri: "http://localhost:5000/auth/callback",
    authority: "https://yourtenantname.b2clogin.com/yourtenantname.onmicrosoft.com/",
    graphApiUrl: "https://graph.microsoft.com/v1.0",
};
  