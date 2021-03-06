var controller = function($scope, Cache, Post, community, onboarding, firstPostQuery, PostManager, currentUser) {
  $scope.onboarding = onboarding;
  $scope.currentUser = currentUser;

  var postManager = new PostManager({
    firstPage: firstPostQuery,
    scope: $scope,
    attr: 'posts',
    cache: function(posts, total) {
      Cache.set('community.posts:' + community.id, {
        posts: posts,
        posts_total: total
      }, {maxAge: 10 * 60});
    },
    query: function() {
      return Post.queryForCommunity({
        communityId: community.id,
        limit: 10,
        offset: $scope.posts.length,
        type: $scope.selected.filter.value,
        sort: $scope.selected.sort.value
      }).$promise;
    }
  });

  postManager.setup();

  $scope.updateView = function(data) {
    $scope.selected = data;
    postManager.reload();
  };

};

module.exports = function(angularModule) {
  angularModule.controller('CommunityPostsCtrl', controller);
};
