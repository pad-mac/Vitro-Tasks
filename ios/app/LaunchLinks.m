// A link that starts the app (a tap on a home screen widget while the app is
// closed) comes with the scene's connection options, which tao (the window
// layer under Tauri) does not read: it handles only links that come while it
// runs (scene:openURLContexts:). This passes those first links on to that
// same method once the scene is up, so they reach the app like any other.
// Built into the app by scripts/ios-widgets.mjs.

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

typedef void (*WillConnect)(id, SEL, UIScene *, UISceneSession *, UISceneConnectionOptions *);

static NSMutableDictionary<NSString *, NSValue *> *originals;

static void vitroWillConnect(id self, SEL _cmd, UIScene *scene, UISceneSession *session, UISceneConnectionOptions *options) {
  WillConnect original = (WillConnect)[originals[NSStringFromClass(object_getClass(self))] pointerValue];
  if (original) original(self, _cmd, scene, session, options);
  NSSet<UIOpenURLContext *> *contexts = options.URLContexts;
  if (contexts.count == 0 || ![self respondsToSelector:@selector(scene:openURLContexts:)]) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [(id<UISceneDelegate>)self scene:scene openURLContexts:contexts];
  });
}

/// Wraps a scene delegate class's scene:willConnectToSession:options: (once per class).
static void vitroHook(Class cls) {
  if (!cls) return;
  NSString *name = NSStringFromClass(cls);
  if (originals[name]) return;
  Method method = class_getInstanceMethod(cls, @selector(scene:willConnectToSession:options:));
  if (!method) return;
  IMP previous = method_setImplementation(method, (IMP)vitroWillConnect);
  originals[name] = [NSValue valueWithPointer:(const void *)previous];
}

static void (*originalSetDelegate)(id, SEL, id);
static void (*originalSetDelegateClass)(id, SEL, Class);

// The app delegate is set before any scene connects; by then tao's scene delegate class exists.
static void vitroSetDelegate(id self, SEL _cmd, id delegate) {
  vitroHook(NSClassFromString(@"TaoSceneDelegate"));
  originalSetDelegate(self, _cmd, delegate);
}

// Any other scene delegate class, as a scene configuration names it.
static void vitroSetDelegateClass(id self, SEL _cmd, Class cls) {
  vitroHook(cls);
  originalSetDelegateClass(self, _cmd, cls);
}

__attribute__((constructor)) static void vitroInstallLaunchLinks(void) {
  originals = [NSMutableDictionary new];
  Method setDelegate = class_getInstanceMethod([UIApplication class], @selector(setDelegate:));
  if (setDelegate) originalSetDelegate = (void *)method_setImplementation(setDelegate, (IMP)vitroSetDelegate);
  Method setDelegateClass = class_getInstanceMethod([UISceneConfiguration class], @selector(setDelegateClass:));
  if (setDelegateClass) originalSetDelegateClass = (void *)method_setImplementation(setDelegateClass, (IMP)vitroSetDelegateClass);
}
