import { sanityClient } from 'sanity:client';
import type { SanityFaq, SanityPage, SanityPost } from '../types/sanity';

export const DEFAULT_FAQS: SanityFaq[] = [
  {
    _id: 'faq-1',
    _type: 'faq',
    question: 'What is an IP address and why do I have one?',
    answer:
      'An IP (Internet Protocol) address is a unique numerical label assigned to every device connected to a computer network that uses the Internet Protocol for communication. It serves two main functions: identifying the host or network interface, and providing the location of the host in the network so data packets can find their destination.',
    order: 1,
  },
  {
    _id: 'faq-2',
    _type: 'faq',
    question: 'What is the difference between IPv4 and IPv6?',
    answer:
      'IPv4 uses 32-bit addresses formatted as four decimal numbers separated by dots (e.g., 192.0.2.1), providing approximately 4.3 billion unique addresses. IPv6 was created because the world ran out of IPv4 addresses; it uses 128-bit addresses formatted in hexadecimal with colons (e.g., 2001:db8::1), providing 340 undecillion unique addresses, built-in security, and faster routing efficiency.',
    order: 2,
  },
  {
    _id: 'faq-3',
    _type: 'faq',
    question: 'Can someone find my physical street address from my IP?',
    answer:
      'No. IP geolocation only maps an IP address to a geographic region, city, postal code area, or Internet Service Provider (ISP) routing hub. It cannot pinpoint your exact house, street address, or room. Only your ISP has records linking an IP to your physical subscription address, which is strictly confidential and protected by law.',
    order: 3,
  },
  {
    _id: 'faq-4',
    _type: 'faq',
    question: 'Does myipv4v6.com log or sell my IP address?',
    answer:
      'Absolutely not. myipv4v6.com is engineered with a strict zero-logging privacy policy. Your IP address is processed dynamically in volatile server memory at Cloudflare edge data centers solely to return your request and is never permanently written to user tracking databases or sold to third parties.',
    order: 4,
  },
  {
    _id: 'faq-5',
    _type: 'faq',
    question: 'Why do some websites show my IPv6 while others show IPv4?',
    answer:
      'Modern devices and networks use a mechanism called Dual-Stack, where your device holds both an IPv4 and an IPv6 address. When connecting to a website, your browser uses an algorithm called Happy Eyeballs (RFC 8305) to test both protocols simultaneously and prefer the fastest connection. If the destination server supports IPv6 and your ISP does too, IPv6 will typically be used.',
    order: 5,
  },
  {
    _id: 'faq-6',
    _type: 'faq',
    question: 'How often does my public IP address change?',
    answer:
      'Most residential internet connections use Dynamic IP addressing assigned by your ISP via DHCP, which may change every few days, weeks, or whenever your home router restarts. Business and server connections often pay for a Static IP address that never changes.',
    order: 6,
  },
];

export const DEFAULT_POSTS: SanityPost[] = [
  {
    _id: 'post-1',
    _type: 'post',
    title: 'IPv4 vs IPv6: Architecture, Differences, and Why the Transition Matters',
    slug: { current: 'ipv4-vs-ipv6-guide' },
    excerpt:
      'An in-depth technical comparison of IPv4 and IPv6 protocols: address space exhaustion, header simplifications, auto-configuration, and how dual-stack routing operates today.',
    publishedAt: '2026-03-15T08:00:00Z',
    author: { name: 'Network Engineering Team' },
    readTimeMinutes: 7,
  },
  {
    _id: 'post-2',
    _type: 'post',
    title: 'What Does Your Public IP Address Actually Reveal About You?',
    slug: { current: 'what-does-ip-reveal' },
    excerpt:
      'Debunking common myths about IP geolocation: what data websites, advertisers, and network operators can see, and what remains private.',
    publishedAt: '2026-03-22T10:30:00Z',
    author: { name: 'Security & Privacy Desk' },
    readTimeMinutes: 5,
  },
  {
    _id: 'post-3',
    _type: 'post',
    title: 'Understanding ASNs: The Hidden Backbone of Global BGP Routing',
    slug: { current: 'understanding-autonomous-system-numbers' },
    excerpt:
      'Learn how Autonomous System Numbers (ASNs) power Border Gateway Protocol (BGP) routing across Tier 1, Tier 2, and eyeball telecom networks.',
    publishedAt: '2026-04-02T14:15:00Z',
    author: { name: 'Infrastructure Team' },
    readTimeMinutes: 8,
  },
];

/**
 * Fetches FAQs from Sanity CMS with automatic fallback.
 */
export async function getFAQs(): Promise<SanityFaq[]> {
  try {
    const query = `*[_type == "faq"] | order(order asc)`;
    const result = await sanityClient.fetch<SanityFaq[]>(query);
    if (result && result.length > 0) {
      return result;
    }
  } catch (err) {
    // Sanity query failed or project empty; fallback silently
  }
  return DEFAULT_FAQS;
}

/**
 * Fetches blog posts from Sanity with automatic fallback.
 */
export async function getBlogPosts(): Promise<SanityPost[]> {
  try {
    const query = `*[_type == "post" && defined(slug.current)] | order(publishedAt desc)`;
    const result = await sanityClient.fetch<SanityPost[]>(query);
    if (result && result.length > 0) {
      return result;
    }
  } catch (err) {
    // Sanity query failed; fallback silently
  }
  return DEFAULT_POSTS;
}

/**
 * Fetches single blog post by slug with fallback.
 */
export async function getBlogPostBySlug(slug: string): Promise<SanityPost | null> {
  try {
    const query = `*[_type == "post" && slug.current == $slug][0]`;
    const result = await sanityClient.fetch<SanityPost>(query, { slug });
    if (result) return result;
  } catch {
    // Fallback
  }
  return DEFAULT_POSTS.find((p) => p.slug.current === slug) || null;
}

/**
 * Fetches a static page by slug from Sanity.
 */
export async function getPageBySlug(slug: string): Promise<SanityPage | null> {
  try {
    const query = `*[_type == "page" && slug.current == $slug][0]`;
    const result = await sanityClient.fetch<SanityPage>(query, { slug });
    if (result) return result;
  } catch {
    // Fallback
  }
  return null;
}
