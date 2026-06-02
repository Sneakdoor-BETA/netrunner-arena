(ns tasks.remove-effect
  (:require
   [clojure.java.io :as io]
   [rewrite-clj.node :as n]
   [rewrite-clj.zip :as z]
   [clojure.string :as str]))

(def cutlery
  (-> "
(defcard 
  {:abilities [{:action true
                :req (req (and
                           1
                                  2
                                  3))
                :cost [(->c :click 1)]
                :effect (effect (move :corp card :deck nil)
                                (shuffle! :corp :deck)
                                (update-all-agenda-points))}]
   :flags {:has-abilities-when-stolen true}})
"
      (z/of-string)
      (z/up)))

(defn add-state-side
  [zloc]
  (if (z/list? zloc)
    (let [zloc (z/down zloc)]
      (if-let [zloc (z/right zloc)]
        (if (and (n/keyword-node? (z/node zloc))
                 (#{:corp :runner} (z/sexpr zloc)))
          (-> zloc
              (z/insert-left 'state)
              (z/up))
          (-> zloc
              (z/insert-left 'state)
              (z/insert-left 'side)
              (z/up)))
        (-> zloc
            (z/insert-right 'side)
            (z/insert-right 'state)
            (z/up))))
    zloc))

(defn edit-body-form [zloc]
  (let [zloc (if (z/whitespace-or-comment? zloc)
               zloc
               (add-state-side zloc))]
    (if-let [zloc (z/right* zloc)]
      (recur zloc)
      (z/up zloc))))

(defn replace-effect
  [zloc]
  (-> zloc
      (z/down)
      (z/replace 'req)
      (z/up)))

(defn update-call
  [zloc]
  (-> zloc
      (replace-effect)
      (z/down)
      (edit-body-form)))

(comment
  (-> cutlery
      (z/prewalk effect-zloc? update-call)
      (z/string)))

(defn effect-zloc? [zloc]
  (and (z/list? zloc)
       (= "effect"
          (-> zloc z/down z/string))))

(defn update-req-fn [zloc]
  (if-let [req (z/get zloc :req)]
    (when (and (z/list? req)
               (= 'req (first (z/sexpr req))))
      (let [req-v (-> req
                     (z/down)
                     (z/right))]
        (when (and (z/list? req-v)
                   (= 'and (first (z/sexpr req-v))))
          (-> req-v
              (z/down)
              (z/remove)
              (z/splice)))))
    zloc))

(defn rewrite-file [zloc]
  ; (z/prewalk zloc effect-zloc? update-call)
  (z/prewalk zloc z/map? update-req-fn))

(comment
  (-> cutlery
      (rewrite-file)
      (z/sexpr)))

(defn process-file [file]
  (->> (z/of-file file)
       (z/up)
       (rewrite-file)
       (z/root-string)
       (spit file)))

(comment
  (doseq [file (sort (file-seq (io/file "src/clj/game")))
          :when (.isFile file)
          :when (not (str/includes? (str file) "macros"))]
    (prn (str file))
    (process-file file))
  )
