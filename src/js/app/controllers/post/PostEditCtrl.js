var filepickerUpload = require('../../services/filepickerUpload')

var hasLocalStorage = function () {
  try {
    return 'localStorage' in window && window.localStorage !== null
  } catch (e) {
    return false
  }
}

var controller = function ($scope, currentUser, communities, Post, growl, $analytics, $history,
  UserMentions, post, $state, $rootScope, Cache, UserCache, GooglePicker) {
  $scope.updatePostDraftStorage = _.debounce(() => {
    if (!hasLocalStorage()) return
    var fields = [
      'title', 'description', 'postType', 'communities',
      'start_time', 'end_time'
    ]
    window.localStorage.postDraft = JSON.stringify(_.pick($scope, fields))
  }, 200)

  var clearPostDraftStorage = function () {
    if (hasLocalStorage()) delete window.localStorage.postDraft
  }

  $scope.maxTitleLength = 140

  var prefixes = {
    intention: "I'd like to create ",
    offer: "I'd like to share ",
    request: "I'm looking for ",
    chat: ''
  }

  // TODO get multiple placeholders to work
  var placeholders = {
    intention: 'Add more detail about this intention. What help do you need to make it happen?',
    offer: 'Add more detail about this offer. Is it in limited supply? Do you wish to be compensated?',
    request: 'Add more detail about what you need. Is it urgent? What can you offer in exchange?',
    chat: ''
  }

  $scope.switchPostType = function (postType) {
    $scope.postType = postType
    $scope.title = prefixes[postType]
    $scope.descriptionPlaceholder = placeholders[postType]
    $scope.updatePostDraftStorage()
  }

  $scope.close = function () {
    $rootScope.postEditProgress = null
    clearPostDraftStorage()
    if ($history.isEmpty()) {
      if (_.isEmpty(communities)) {
        $state.go('home.allPosts')
      } else {
        $state.go('community.posts', {community: communities[0].slug})
      }
    } else {
      $history.go(-1)
    }
  }

  $scope.addImage = function () {
    $scope.addingImage = true

    function finish () {
      $scope.addingImage = false
      $scope.$apply()
    }

    filepickerUpload({
      path: format('user/%s/seeds', currentUser.id),
      convert: {width: 800, format: 'jpg', fit: 'max', rotate: 'exif'},
      success: function (url) {
        $scope.imageUrl = url
        $scope.imageRemoved = false
        finish()
      },
      failure: () => finish()
    })
  }

  $scope.removeImage = function () {
    delete $scope.imageUrl
    $scope.imageRemoved = true
  }

  var validate = function () {
    var invalidTitle = _.contains(_.values(prefixes), $scope.title.trim())
    var noCommunities = _.isEmpty(communities)
    // TODO show errors in UI
    if (invalidTitle) window.alert('Please fill in a title')
    if (noCommunities) window.alert('Please pick at least one community')

    return !invalidTitle && !noCommunities
  }

  var clearCache = function () {
    communities.forEach(c => Cache.drop('community.posts:' + c.id))
    UserCache.posts.clear(currentUser.id)
    UserCache.allPosts.clear(currentUser.id)
  }

  var update = function (data) {
    post.update(data, function () {
      $analytics.eventTrack('Edit Post', {
        has_mention: $scope.hasMention,
        community_name: communities[0].name,
        community_id: communities[0].id,
        type: $scope.postType
      })
      clearCache()
      clearPostDraftStorage()
      $state.go('post', {postId: post.id})
      growl.addSuccessMessage('Post updated.')
    }, function (err) {
      $scope.saving = false
      growl.addErrorMessage(err.data)
      $analytics.eventTrack('Edit Post Failed')
    })
  }

  var create = function (data) {
    new Post(data).$save(function () {
      $analytics.eventTrack('Add Post', {
        has_mention: $scope.hasMention,
        community_name: communities[0].name,
        community_id: communities[0].id
      })
      clearCache()
      $scope.close()
      growl.addSuccessMessage('Post created!')
      clearPostDraftStorage()
      currentUser.post_count += 1
    }, function (err) {
      $scope.saving = false
      growl.addErrorMessage(err.data)
      $analytics.eventTrack('Add Post Failed')
    })
  }

  $scope.save = function () {
    if (!validate()) return
    $scope.saving = true

    var data = _.merge({
      name: $scope.title,
      description: $scope.description,
      type: $scope.postType,
      communities: communities.map(c => c.id)
    }, _.pick($scope, [
      'description',
      'docs', 'removedDocs', 'imageUrl', 'imageRemoved',
      'public', 'start_time', 'end_time'
    ]))
    return ($scope.editing ? update : create)(data)
  }

  $scope.searchPeople = function (query) {
    UserMentions.searchPeople(query).$promise.then(function (items) {
      $scope.people = items
    })
  }

  $scope.getPeopleTextRaw = function (user) {
    $analytics.eventTrack('Post: Add New: @-mention: Lookup', {query: user.name})
    $scope.hasMention = true
    return UserMentions.userTextRaw(user)
  }

  $scope.docs = []

  // round up to next quarter hour
  var now = new Date()
  $scope.startTime = new Date(Math.ceil(now.getTime() / 900000) * 900000)
  $scope.endTime = $scope.startTime

  if (post) {
    $scope.editing = true
    $scope.switchPostType(post.type)
    $scope.title = post.name
    ;['public', 'start_time', 'end_time'].forEach(attr => $scope[attr] = post[attr])

    var image = _.find(post.media || [], m => m.type === 'image')
    if (image) $scope.imageUrl = image.url

    $scope.docs = _.filter(post.media || [], m => m.type === 'gdoc')

    if (post.description.substring(0, 3) === '<p>') {
      $scope.description = post.description
    } else {
      $scope.description = format('<p>%s</p>', post.description)
    }
  } else if (hasLocalStorage() && window.localStorage.postDraft) {
    try {
      _.merge($scope, JSON.parse(window.localStorage.postDraft))
    } catch(e) {}
  } else {
    $scope.switchPostType('chat')
  }

  $scope.communityOptions = _.map(currentUser.memberships, function (membership) {
    return membership.community
  })

  $scope.findCommunities = function (query) {
    return _.filter($scope.communityOptions, c =>
      _.any(c.name.split(' '), w =>
        w.toLowerCase().startsWith(query.toLowerCase())))
  }

  $scope.communities = communities
  $scope.removedDocs = []

  $scope.addDoc = function () {
    GooglePicker.init({
      onPick: function (doc) {
        $scope.docs.push({
          url: doc.url,
          name: doc.name,
          thumbnail_url: doc.iconUrl
        })
        $scope.$apply()
      }
    }).then(picker => {
      picker.setVisible(true)
    })
  }

  $scope.removeDoc = function (index) {
    $scope.removedDocs.push($scope.docs.splice(index, 1)[0])
  }

  $scope.datePickerStatus = {}
  $scope.toggleDatePicker = function ($event, num) {
    $event.preventDefault()
    $event.stopPropagation()
    var attr = 'opened' + num
    var status = $scope.datePickerStatus
    status[attr] = !status[attr]
  }

  $scope.$watch('startTime', $scope.updatePostDraftStorage)
  $scope.$watch('endTime', $scope.updatePostDraftStorage)
}

module.exports = function (angularModule) {
  angularModule.controller('PostEditCtrl', controller)
}
