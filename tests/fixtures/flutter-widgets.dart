import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/user.dart';
import '../models/post.dart';
import '../providers/auth_provider.dart';
import '../providers/feed_provider.dart';
import '../services/api_service.dart';
import '../widgets/post_card.dart';
import '../widgets/avatar.dart';
import '../widgets/shimmer_list.dart';
import '../utils/date_formatter.dart';
import '../utils/analytics.dart';

/// Main feed screen showing posts from followed users.
/// Supports infinite scroll, pull-to-refresh, and optimistic updates.
class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen>
    with AutomaticKeepAliveClientMixin {
  final ScrollController _scrollController = ScrollController();
  bool _isLoadingMore = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    Analytics.screen('feed');
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_isLoadingMore) return;
    setState(() => _isLoadingMore = true);
    await ref.read(feedProvider.notifier).loadMore();
    setState(() => _isLoadingMore = false);
  }

  Future<void> _refresh() async {
    Analytics.event('feed_refresh');
    await ref.read(feedProvider.notifier).refresh();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final feedAsync = ref.watch(feedProvider);
    final currentUser = ref.watch(authProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Feed'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => context.push('/search'),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
          if (currentUser != null)
            GestureDetector(
              onTap: () => context.push('/profile/${currentUser.id}'),
              child: Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Avatar(user: currentUser, radius: 16),
              ),
            ),
        ],
      ),
      body: feedAsync.when(
        loading: () => const ShimmerList(itemCount: 6),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 12),
              Text('Failed to load feed: $err'),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _refresh,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (posts) => RefreshIndicator(
          onRefresh: _refresh,
          child: posts.isEmpty
              ? const Center(child: Text('No posts yet. Follow some users!'))
              : ListView.builder(
                  controller: _scrollController,
                  itemCount: posts.length + (_isLoadingMore ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index == posts.length) {
                      return const Center(
                        child: Padding(
                          padding: EdgeInsets.all(16),
                          child: CircularProgressIndicator(),
                        ),
                      );
                    }
                    final post = posts[index];
                    return PostCard(
                      key: ValueKey(post.id),
                      post: post,
                      onLike: () => _handleLike(post),
                      onComment: () => context.push('/post/${post.id}/comments'),
                      onShare: () => _handleShare(post),
                      onAuthorTap: () => context.push('/profile/${post.author.id}'),
                    );
                  },
                ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/compose'),
        child: const Icon(Icons.edit_outlined),
      ),
    );
  }

  Future<void> _handleLike(Post post) async {
    Analytics.event('post_like', {'post_id': post.id});
    await ref.read(feedProvider.notifier).toggleLike(post.id);
  }

  Future<void> _handleShare(Post post) async {
    Analytics.event('post_share', {'post_id': post.id});
    await ref.read(feedProvider.notifier).sharePost(post.id);
  }
}

class ProfileScreen extends ConsumerWidget {
  final String userId;
  const ProfileScreen({super.key, required this.userId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(userId));
    final postsAsync = ref.watch(userPostsProvider(userId));

    return Scaffold(
      body: profileAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (profile) => NestedScrollView(
          headerSliverBuilder: (context, _) => [
            SliverAppBar(
              expandedHeight: 200,
              pinned: true,
              flexibleSpace: FlexibleSpaceBar(
                title: Text(profile.displayName),
                background: profile.coverUrl != null
                    ? Image.network(profile.coverUrl!, fit: BoxFit.cover)
                    : Container(color: Theme.of(context).colorScheme.primary),
              ),
              actions: [
                if (profile.id != ref.read(authProvider).valueOrNull?.id)
                  FilledButton(
                    onPressed: () => ref
                        .read(profileProvider(userId).notifier)
                        .toggleFollow(),
                    child: Text(profile.isFollowing ? 'Unfollow' : 'Follow'),
                  ),
                const SizedBox(width: 8),
              ],
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Avatar(user: profile, radius: 40),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              _Stat(label: 'Posts', value: profile.postCount),
                              _Stat(label: 'Followers', value: profile.followerCount),
                              _Stat(label: 'Following', value: profile.followingCount),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(profile.displayName,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold)),
                    if (profile.bio != null) ...[
                      const SizedBox(height: 4),
                      Text(profile.bio!),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      'Joined ${DateFormatter.relative(profile.createdAt)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ],
          body: postsAsync.when(
            loading: () => const ShimmerList(itemCount: 4),
            error: (e, _) => Center(child: Text('Error loading posts: $e')),
            data: (posts) => ListView.builder(
              itemCount: posts.length,
              itemBuilder: (_, i) => PostCard(post: posts[i]),
            ),
          ),
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final int value;
  const _Stat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Text('$value',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold)),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}
