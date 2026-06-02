(ns game.macros
  (:require [clojure.tools.analyzer.jvm :as a.j]
            [clojure.tools.analyzer.ast :as ast]))

(def forms
  '{runner (:runner @state)
    corp (:corp @state)
    run (:run @state)
    run-server (get-in @state (concat [:corp :servers] (:server (:run @state))))
    run-ices (get-in @state (concat [:corp :servers] (:server (:run @state)) [:ices]))
    run-position (get-in @state [:run :position])
    current-ice (game.core.ice/get-current-ice state)
    corp-reg (get-in @state [:corp :register])
    corp-reg-last (get-in @state [:corp :register-last-turn])
    runner-reg (get-in @state [:runner :register])
    runner-reg-last (get-in @state [:runner :register-last-turn])
    target (let [t (first targets)]
             (if (and (map? t)
                      (contains? t :uuid)
                      (contains? t :value))
               (:value t)
               t))
    context (first targets)
    installed (#{:rig :servers} (first (game.core.card/get-zone card)))
    remotes (game.core.board/get-remote-names state)
    servers (game.core.servers/zones->sorted-names (game.core.board/get-zones state))
    unprotected (let [server (second (game.core.card/get-zone card))]
                  (empty? (get-in @state [:corp :servers server :ices])))
    runnable-servers (game.core.servers/zones->sorted-names
                      (game.core.runs/get-runnable-zones state side eid card nil))
    hq-runnable (some #{:hq} (game.core.runs/get-runnable-zones state))
    rd-runnable (some #{:rd} (game.core.runs/get-runnable-zones state))
    archives-runnable (some #{:archives} (game.core.runs/get-runnable-zones state))
    tagged (jinteki.utils/is-tagged? state)
    ;; only intended for use in event listeners on (pre-/post-, un-)successful-run or run-ends
    ;; true if the run was initiated by this card
    this-card-run (and (get-in card [:special :run-id])
                       (= (get-in card [:special :run-id])
                          (:run-id (first targets))))
    ;; intended to check if the current card is the source of an active run
    this-card-is-run-source (and (:run @state) (= (:cid card) (get-in @state [:run :source-card :cid])))
    this-server (let [s (game.core.card/get-zone card)
                      r (:server (:run @state))]
                  (= (second s) (first r)))
    corp-currently-drawing (seq (peek (get-in @state [:corp :register :currently-drawing])))
    runner-currently-drawing (seq (peek (get-in @state [:runner :register :currently-drawing])))})

;; Taken from https://github.com/Bronsa/tools.analyzer.jvm.deps/commit/8c7c3936e6f73e85f9e7cc122a2142c43d459c12
;; TODO: Switch from this inlined function to requiring the right package when the new version drops.
(defn- find-undefined-locals
  "Takes a form and returns a set of all the free locals in it"
  [expr]
  (->> (binding [a.j/run-passes identity]
         (a.j/analyze expr (a.j/empty-env)))
       ast/nodes
       (filter (fn [{:keys [op]}] (= op :maybe-class)))
       (map :class)
       (remove (fn [x] (-> x str (.contains "."))))
       (into #{})))

(defn- emit-only
  [needed-locals]
  (mapcat #(when-let [form (get forms %)] [% form]) needed-locals))

(defmacro effect
  "Returns a function taking `state`, `side`, `eid`, `card`, and `targets`, binding
  any referenced local variables defined in [game.macros/forms].

  Useful for `:effect` in ability maps."
  [& exprs]
  (let [needed-locals (find-undefined-locals exprs)
        nls (emit-only needed-locals)]
    `(fn ~['state 'side 'eid 'card 'targets]
       (assert (or (nil? (:source ~'eid)) (:cid (:source ~'eid)))
               (str ":source should be a card, received: " (:source ~'eid)))
       (let [~@nls
             ret# (do ~@exprs)]
         ret#))))

(defmacro msg
  "Does the same as [game.macros/effect] except it wraps the provided exprs in `str`.

  Useful for `:msg` in ability maps."
  [& exprs]
  `(effect (str ~@exprs)))

(defmacro req
  "Does the same as [game.macros/effect] except it wraps the provided exprs in `and`.

  Useful for `:req` in ability maps."
  [& exprs]
  `(effect (and ~@exprs)))

(defmacro wait-for
  "Wrap `body` in a callback, execute `action` with the assumption that `action` will call
  `effect-completed` on an `eid`, which will execute the callback. The `eid` can be skipped
  in the action call, resulting in a fresh eid being inserted (using `(make-eid state eid)`
  with the assumption that an `eid` exists in the local environment).

  First arg can either be the async function call (a function that takes an `eid` at arg 3)
  or a 2-element vector of the async-result and the async function call. If a binding vector
  is not given, the anaphoric variable `async-result` is bound.

  For example:
  ```clojure
  (wait-for (draw state :corp 1)
    (system-msg state :corp async-result)
    (effect-completed state :corp eid)))
  ;; is equivalent to
  ; (wait-for [async-result (draw state :corp (make-eid state eid) 1)]
  ;   (system-msg state :corp async-result)
  ;   (effect-completed state :corp eid)))

  ;; both the eid and the bound variable can be changed
  (wait-for [drawn-cards (draw state :corp some-other-eid 1)]
    (system-msg state :corp drawn-cards)
    (effect-completed state :corp eid)))
  ```"
  {:arglists '([action & body] [[binding action] & body])}
  [action & body]
  (when (vector? action)
    (assert (= 2 (count action)) "Both bind and call must be in binding vec"))
  (let [[binds action] (if (vector? action) action ['async-result action])
        binds [{binds :result}]
        abnormal? (#{'handler 'payable?} (first action))
        to-take (if abnormal? 4 3)
        fn-name (gensym (name (first action)))
        [_ state _ eid?] (if abnormal? (next action) action)]
    `(let [eid?# ~eid?
           use-eid# (and (map? eid?#) (:eid eid?#))
           existing-eid# ~(when (contains? &env 'eid) 'eid)
           new-eid# (if use-eid# eid?# (game.core.eid/make-eid ~state existing-eid#))]
       (game.core.eid/register-effect-completed
         ~state new-eid#
         (fn ~fn-name ~binds
           (let [ret# (do ~@body)]
             ret#)))
       (if use-eid#
         (~@(take to-take action) new-eid# ~@(drop (inc to-take) action))
         (~@(take to-take action) new-eid# ~@(drop to-take action))))))

(comment
  (macroexpand
    '(wait-for (draw state :corp (make-eid state) 1)
               (system-msg state :corp async-result)
               (effect-completed state :corp eid)))
  (macroexpand
    '(wait-for [drawn-cards (draw state :corp (make-eid state) 1)]
               (system-msg state :corp drawn-cards)
               (effect-completed state :corp eid)))
  )

(defmacro continue-ability
  [state side ability card targets]
  `(let [ability# ~ability
         ability# (if (:eid ability#) ability# (assoc ability# :eid ~'eid))]
     (game.core.engine/resolve-ability ~state ~side ability#  ~card ~targets)))

(defmacro when-let*
  ([bindings & body]
   (if (seq bindings)
     `(when-let [~(first bindings) ~(second bindings)]
        (when-let* ~(drop 2 bindings) ~@body))
     `(do ~@body))))
