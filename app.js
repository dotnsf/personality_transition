//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    jwt = require( 'jsonwebtoken' ),
    OAuth = require( 'oauth' ),
    request = require( 'request' ),
    session = require( 'express-session' ),
    Twitter = require( 'twitter' ),
    //watson_pi_v3 = require( 'watson-developer-cloud/personality-insights/v3' ),
    watson_pi_v3 = require( 'ibm-watson/personality-insights/v3' ),
    settings = require( './settings' ),
    app = express();
var { IamAuthenticator } = require( 'ibm-watson/auth' );
var settings = require( './settings' );

var pi = new watson_pi_v3({
  authenticator: new IamAuthenticator({
    apikey: settings.watson_pi_apikey
  }),
  url: settings.watson_pi_url,
  version: '2017-10-13'
});

var db = null;
var cloudant = cloudantlib( { account: settings.cloudant_username, password: settings.cloudant_password } );
if( cloudant ){
  cloudant.db.get( settings.cloudant_dbname, function( err, body ){
    if( err ){
      if( err.statusCode == 404 ){
        cloudant.db.create( settings.cloudant_dbname, function( err, body ){
          if( err ){
            db = null;
          }else{
            db = cloudant.db.use( settings.cloudant_dbname );
          }
        });
      }else{
        db = cloudant.db.use( settings.cloudant_dbname );
      }
    }else{
      db = cloudant.db.use( settings.cloudant_dbname );
    }
  });
}

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

app.use( session({
  secret: settings.superSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,           //. https で使う場合は true
    maxage: 1000 * 60 * 60   //. 60min
  }
}) );


//. Twitter API
var oa = new OAuth.OAuth(
  'https://api.twitter.com/oauth/request_token',
  'https://api.twitter.com/oauth/access_token',
  settings.twitter_consumer_key,
  settings.twitter_consumer_secret,
  '1.0A',
  null,
  'HMAC-SHA1'
);

app.get( '/twitter', function( req, res ){
  oa.getOAuthRequestToken( function( err, oauth_token, oauth_token_secret, results ){
    if( err ){
      console.log( err );
      res.redirect( '/' );
    }else{
      req.session.oauth = {};
      req.session.oauth.token = oauth_token;
      req.session.oauth.token_secret = oauth_token_secret;
      res.redirect( 'https://twitter.com/oauth/authenticate?oauth_token=' + oauth_token );
    }
  });
});

app.get( '/twitter/callback', function( req, res ){
  if( req.session.oauth ){
    req.session.oauth.verifier = req.query.oauth_verifier;
    var oauth = req.session.oauth;
    oa.getOAuthAccessToken( oauth.token, oauth.token_secret, oauth.verifier, function( err, oauth_access_token, oauth_access_token_secret, result ){
      if( err ){
        console.log( err );
        res.redirect( '/' );
      }else{
        req.session.oauth.provider = 'twitter';
        req.session.oauth.user_id = result.user_id;
        req.session.oauth.screen_name = result.screen_name;
        req.session.oauth.access_token = oauth_access_token;
        req.session.oauth.access_token_secret = oauth_access_token_secret;
        //console.log( req.session.oauth );

        var token = jwt.sign( req.session.oauth, settings.superSecret, { expiresIn: '25h' } );
        req.session.token = token;
        req.session.results = [];

        var client = new Twitter({
          consumer_key: settings.twitter_consumer_key,
          consumer_secret: settings.twitter_consumer_secret,
          access_token_key: oauth_access_token,
          access_token_secret: oauth_access_token_secret
        });
        var params = { count: 200 };
        client.get( 'statuses/user_timeline', params, function( err, tweets, response ){
          //console.log( err );
          if( err ){
            res.redirect( '/' );
          }else{
            var count_per_block = 40;
            var block_count = 200 / count_per_block;
            //. tweets を 40 件ずつ 5 ブロックに分けてまとめる
            //console.log( tweets );
            var created_ats = [];
            var texts = [];
            var results = [];
            var idx = 0;
            for( var i = 0; i < block_count; i ++ ){
              var text = '';
              for( var j = 0; j < count_per_block; j ++ ){
                var tweet = tweets[block_count*i+j];
                //console.log( tweet );  //. tweet.created_at = 'Tue Mar 03 15:03:15 +0000 2020'
                if( j == 0 ){
                  created_ats.push( tweet.created_at );
                }
                text += tweet.text;
              }
              texts.push( text );

              var pi_params = {
                content: text,
                contentType: 'text/plain',
                consumption_preferences: true,
                raw_scores: true,
                headers: {
                  'accept-language': 'ja',
                  'content-language': 'ja',
                  'accept': 'application/json'
                }
              };
              pi.profile( pi_params, function( error, response ){
                var r = {};
                if( error ){
                }else{
                  req.session.results.push( response.result );
                  //. { word_count: 9100, personality: [], needs[], values[], .. }
                }
                idx ++;

                if( idx == block_count ){
                  var doc = {
                    user: {
                      user_id: result.user_id,
                      screen_name: result.screen_name
                    },
                    results: req.session.results,
                    tweeteds: created_ats,
                    datetime: timestamp2datetime( ( new Date() ).getTime() )
                  };
                  db.insert( doc, function( err, body ){
                    var id = '';
                    if( err ){
                      console.log( JSON.stringify( err ) );
                    }else{
                      id = body.id;
                      //console.log( JSON.stringify( body ) );
                    }

                    //res.redirect( '/' );
                    res.redirect( '/transition/' + id );
                  });
                }
              });
            }
          }
        });
      }
    });
  }else{
    res.redirect( '/' );
  }
});

app.post( '/logout', function( req, res ){
  req.session.token = null;
  //res.redirect( '/' );
  res.write( JSON.stringify( { status: true }, 2, null ) );
  res.end();
});


app.get( '/', function( req, res ){
  var user = null;
  var result = null;
  if( req.session && req.session.result ){
    result = req.session.result;
  }
  if( req.session && req.session.token ){
    var token = req.session.token;
    jwt.verify( token, settings.superSecret, function( err, user0 ){
      if( user0 ){
        user = user0;
      }
      res.render( 'index', { user: user, result: result } );
    });
  }else{
    res.render( 'index', { user: user, result: result } );
  }
});

app.get( '/transition/:id', function( req, res ){
  var id = req.params.id;

  if( id && db ){
    db.get( id, { include_docs: true }, function( err, doc ){
      if( err ){
        res.render( 'error', { id: id, error: err } );
      }else{
        doc.id = id;
        res.render( 'transition', doc );
      }
    });
    /*
    res.render( 'transition', { id: id } );
    */
  }else{
    res.render( 'error', { id: id, error: { message: "id and/or db is null." } } );
  }
});

app.get( '/get/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var id = req.params.id;

  if( id && db ){
    db.get( id, { include_docs: true }, function( err, doc ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err }, 2, null ) );
        res.end();
      }else{
        doc.id = id;
        res.write( JSON.stringify( { status: true, doc: doc }, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "id and/or db is null." }, 2, null ) );
    res.end();
  }
});

app.get( '/profileimage', function( req, res ){
  var screen_name = req.query.screen_name;
  if( screen_name ){
    var option = {
      url: 'https://twitter.com/' + screen_name + '/profile_image?size=original',
      method: 'GET'
    };
    request( option, ( err0, res0, body0 ) => {
      if( err0 ){
        return res.status( 403 ).send( { status: false, error: err0 } );
      }else{
        res.redirect( 'https://pbs.twimg.com' + res0.request.path );
      }
    });
  }else{
    return res.status( 403 ).send( { status: false, error: 'No screen_name provided.' } );
  }
});

function timestamp2datetime( ts ){
  var dt = new Date( ts );
  var yyyy = dt.getFullYear();
  var mm = dt.getMonth() + 1;
  var dd = dt.getDate();
  var hh = dt.getHours();
  var nn = dt.getMinutes();
  var ss = dt.getSeconds();
  //var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
  //  + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
  var datetime = yyyy + '年' + mm + '月' + dd + '日';
  return datetime;
}

var port = process.env.port || 8080;
app.listen( port );
console.log( "server stating on " + port + " ..." );
