"""The same-origin rule for state-changing requests.

Nothing here reads `state`: the comparison is against the request's own `Host`
header, deliberately (see `_authority_matches`).
"""

import urllib.parse


def _split_authority(authority):
    """(host, port) from a `host[:port]` authority; port is None when elided.

    An IPv6 literal is bracketed (`[::1]:8078`), so its port is only ever after
    the closing bracket — splitting on the last colon unconditionally would cut
    the address itself in half. Lowercased because hostnames are
    case-insensitive and a browser may normalise its Origin differently from
    the Host a proxy forwards.
    """
    authority = authority.strip()
    if authority.startswith("["):
        end = authority.find("]")
        if end < 0:
            return authority.lower(), None
        host = authority[: end + 1].lower()
        rest = authority[end + 1 :]
        if rest.startswith(":") and rest[1:].isdigit():
            return host, int(rest[1:])
        return host, None
    if authority.count(":") == 1:
        host, port = authority.rsplit(":", 1)
        if port.isdigit():
            return host.lower(), int(port)
    return authority.lower(), None


def _authority_matches(scheme, claimed_netloc, host_header):
    """Whether an Origin/Referer authority names the host we were asked for.

    The comparison is against the request's own `Host` header and nothing else.
    That is the client-facing authority, because the proxy chain forwards it
    unchanged (roomcad.caddy sets `header_up Host {host}`), so it is the
    hostname the user actually used on localhost and in production alike; a
    hard-coded hostname would only work on one of them. `_is_https()` and
    PROXY_HOPS are deliberately not consulted — they say which scheme reached
    our hop and where the real client sits, neither of which is this authority.

    A browser leaves the default port off both Origin and Host, but a proxy or
    an older client may spell out :443/:80, so a port present on only one side
    still matches when it is the default for the claimed scheme. Anything else
    is a mismatch.
    """
    default_port = {"http": 80, "https": 443}.get(scheme.lower())
    claimed_host, claimed_port = _split_authority(claimed_netloc)
    host, host_port = _split_authority(host_header)
    if claimed_host != host:
        return False
    if claimed_port == host_port:
        return True
    if claimed_port is None:
        return host_port is None or host_port == default_port
    if host_port is None:
        return claimed_port == default_port
    return False


class OriginMixin:
    """`_require_same_origin`, mixed into the request Handler."""

    def _require_same_origin(self):
        """Refuses a cross-site state-changing request, or returns True.

        This is the second line behind the session cookie's `SameSite=Lax`.
        Lax does stop the browser attaching the cookie to a cross-site
        POST/DELETE, but that is one attribute on one cookie and it is the only
        defence there is — and POST /api/logout is deliberately unauthenticated
        so that a cross-site request can still clear somebody's cookie. Origin
        is the header the browser writes itself and cannot be forged by the
        page, and a browser always sends it on a cross-site POST, so a request
        that positively names a different origin is refused.

        A request carrying neither Origin nor Referer is allowed. That is curl,
        the test suite and a same-origin form post: absent is not the signal an
        attack leaves, refusing it would break scripted use of the API, and the
        browser-driven attack always carries Origin. A Referer is only a
        fallback for clients that send one but not the other, and it is
        consulted second because a referrer policy can suppress it while Origin
        is the deliberate statement of where the request came from. GET is not
        covered: it changes nothing.
        """
        claimed = self.headers.get("Origin")
        if claimed is None:
            claimed = self.headers.get("Referer")
            if claimed is None:
                return True
        try:
            parts = urllib.parse.urlsplit(claimed.strip())
        except ValueError:
            return False
        if not parts.scheme or not parts.netloc:
            # "null" (a sandboxed or opaque origin) and anything else that is
            # not a real URL names no origin we can match, so it does not get
            # the benefit of the doubt.
            return False
        host = self.headers.get("Host")
        if not host:
            # HTTP/1.1 requires Host; with none there is nothing to compare the
            # claim against, and an unverifiable claim is not a match.
            return False
        return _authority_matches(parts.scheme, parts.netloc, host)
