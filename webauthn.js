import { apiBaseUrl } from "./lib/client.js";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { getCsrfToken, getProviders, __NEXTAUTH } from "./react.js";
const logger = {
    debug: console.debug,
    error: console.error,
    warn: console.warn,
};
/**
 * Fetch webauthn options from server and prompt user for authentication or registration.
 * Returns either the completed WebAuthn response or an error request.
 *
 * @param providerID provider ID
 * @param options SignInOptions
 * @returns WebAuthn response or error
 */
async function webAuthnOptions(providerID, nextAuthConfig, options) {
    const baseUrl = apiBaseUrl(nextAuthConfig);
    // @ts-expect-error
    const params = new URLSearchParams(options);
    const optionsResp = await fetch(`${baseUrl}/webauthn-options/${providerID}?${params}`);
    if (!optionsResp.ok) {
        return { error: optionsResp };
    }
    const optionsData = await optionsResp.json();
    if (optionsData.action === "authenticate") {
        const webAuthnResponse = await startAuthentication(optionsData.options);
        return { data: webAuthnResponse, action: "authenticate" };
    }
    else {
        const webAuthnResponse = await startRegistration(optionsData.options);
        return { data: webAuthnResponse, action: "register" };
    }
}
/**
 * Initiate a signin flow or send the user to the signin page listing all possible providers.
 * Handles CSRF protection.
 */
export async function signIn(provider, options, authorizationParams) {
    const { callbackUrl = window.location.href, redirect = true } = options ?? {};
    const baseUrl = apiBaseUrl(__NEXTAUTH);
    const providers = await getProviders();
    if (!providers) {
        window.location.href = `${baseUrl}/error`;
        return;
    }
    if (!provider || !(provider in providers)) {
        window.location.href = `${baseUrl}/signin?${new URLSearchParams({
            callbackUrl,
        })}`;
        return;
    }
    const isCredentials = providers[provider].type === "credentials";
    const isEmail = providers[provider].type === "email";
    const isWebAuthn = providers[provider].type === "webauthn";
    const isSupportingReturn = isCredentials || isEmail || isWebAuthn;
    const signInUrl = `${baseUrl}/${isCredentials || isWebAuthn ? "callback" : "signin"}/${provider}`;
    // Execute WebAuthn client flow if needed
    const webAuthnBody = {};
    if (isWebAuthn) {
        const { data, error, action } = await webAuthnOptions(provider, __NEXTAUTH, options);
        if (error) {
            logger.error(new Error(await error.text()));
            return;
        }
        webAuthnBody.data = JSON.stringify(data);
        webAuthnBody.action = action;
    }
    const csrfToken = await getCsrfToken();
    const res = await fetch(`${signInUrl}?${new URLSearchParams(authorizationParams)}`, {
        method: "post",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Auth-Return-Redirect": "1",
        },
        // @ts-expect-error
        body: new URLSearchParams({
            ...options,
            ...webAuthnBody,
            csrfToken,
            callbackUrl,
        }),
    });
    const data = await res.json();
    // TODO: Do not redirect for Credentials and Email providers by default in next major
    if (redirect || !isSupportingReturn) {
        const url = data.url ?? callbackUrl;
        window.location.href = url;
        // If url contains a hash, the browser does not reload the page. We reload manually
        if (url.includes("#"))
            window.location.reload();
        return;
    }
    const error = new URL(data.url).searchParams.get("error");
    if (res.ok) {
        await __NEXTAUTH._getSession({ event: "storage" });
    }
    return {
        error,
        status: res.status,
        ok: res.ok,
        url: error ? null : data.url,
    };
}
